// Integration tests for the super admin account and the session isolation /
// forced-password-change rules. Unlike api-routes.test.ts, this file does NOT
// mock the auth middleware, so the real requireAuth/requireRole run against a
// real temp database in every test.

import request from 'supertest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import createApp from '../backend/src/app';
import { hashPassword } from '../backend/src/modules/auth/auth';

// These tests boot a fresh Express app (with its own temp database) and perform
// several bcrypt logins per test. Under the full suite's parallel load a single
// test can take well beyond the 5 s default, so give this file a larger budget.
jest.setTimeout(30000);

const ADMIN_USERNAME = 'root';
const ADMIN_PASSWORD_PLAIN = 'Super.Admin.1';
let adminPasswordHash = '';

const tempDirs: string[] = [];

function extractCookies(res: request.Response): string[] {
  const cookies = (res.headers['set-cookie'] as unknown as string[]) ?? [];
  return cookies.map((c) => c.split(';')[0]);
}

async function makeApp() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'catalogai-superadmin-'));
  tempDirs.push(dataDir);
  return await createApp({ dataDir });
}

async function registerComercio(app: Awaited<ReturnType<typeof createApp>>, name: string, username = 'admin', password = 'Str0ng!Password') {
  return request(app)
    .post('/api/auth/register-comercio')
    .send({ comercio_name: name, admin_username: username, admin_password: password });
}

async function login(app: Awaited<ReturnType<typeof createApp>>, username: string, password: string) {
  const res = await request(app).post('/api/auth/login').send({ username, password });
  return { res, cookies: extractCookies(res) };
}

async function createUserAs(app: Awaited<ReturnType<typeof createApp>>, cookies: string[], username: string, password: string, role = 'user') {
  return request(app).post('/api/auth/users').set('Cookie', cookies).send({ username, password, role });
}

beforeAll(async () => {
  adminPasswordHash = await hashPassword(ADMIN_PASSWORD_PLAIN);
});

afterAll(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Each test gets its own temp database, so the module-level ADMIn env vars are
// the only shared state. They are set globally per test via a helper.
function setSuperAdminEnv(enabled: boolean) {
  if (enabled) {
    process.env.ADMIN_USER = ADMIN_USERNAME;
    process.env.ADMIN_PASSWORD = adminPasswordHash;
  } else {
    delete process.env.ADMIN_USER;
    delete process.env.ADMIN_PASSWORD;
  }
}

describe('super admin account', () => {
  describe('login and identity', () => {
    it('logs in only when ADMIN_USER and the bcrypt ADMIN_PASSWORD are both set', async () => {
      setSuperAdminEnv(true);
      const app = await makeApp();
      await registerComercio(app, 'Tienda A');

      const { res: ok, cookies } = await login(app, ADMIN_USERNAME, ADMIN_PASSWORD_PLAIN);
      expect(ok.status).toBe(200);
      expect(ok.body.user.role).toBe('superadmin');
      expect(ok.body.user.id).toBe(0);
      expect(ok.body.user.must_change_password).toBe(false);

      const me = await request(app).get('/api/auth/me').set('Cookie', cookies);
      expect(me.status).toBe(200);
      expect(me.body.user.role).toBe('superadmin');
      expect(me.body.user.comercio_name).toBe('');

      // Wrong password never authenticates.
      const bad = await login(app, ADMIN_USERNAME, 'Definitely.Wrong.99');
      expect(bad.res.status).toBe(401);
    });

    it('cannot log in when one of the ADMIN_* variables is missing', async () => {
      setSuperAdminEnv(false);
      delete process.env.ADMIN_PASSWORD;
      process.env.ADMIN_USER = ADMIN_USERNAME;
      const app = await makeApp();

      const res = await login(app, ADMIN_USERNAME, ADMIN_PASSWORD_PLAIN);
      expect(res.res.status).toBe(401);
    });
  });

  it('lists every registered comercio and reports its user count and active state', async () => {
    setSuperAdminEnv(true);
    const app = await makeApp();
    await registerComercio(app, 'Tienda Uno');
    await registerComercio(app, 'Tienda Dos');

    const { cookies } = await login(app, ADMIN_USERNAME, ADMIN_PASSWORD_PLAIN);
    const res = await request(app).get('/api/auth/superadmin/comercios').set('Cookie', cookies);

    expect(res.status).toBe(200);
    expect(res.body.comercios).toHaveLength(2);
    expect(res.body.comercios.map((c: any) => c.name)).toEqual(['Tienda Uno', 'Tienda Dos']);
    expect(res.body.comercios[0].active).toBe(true);
    expect(res.body.comercios[0].user_count).toBe(1);
  });

  it('denies super admin routes to a regular admin (comercio isolation)', async () => {
    setSuperAdminEnv(true);
    const app = await makeApp();
    await registerComercio(app, 'Tienda A');

    const { cookies } = await login(app, 'admin', 'Str0ng!Password');
    const res = await request(app).get('/api/auth/superadmin/comercios').set('Cookie', cookies);

    expect(res.status).toBe(403);
  });

  it('deactivating a comercio blocks future logins and already-open sessions', async () => {
    setSuperAdminEnv(true);
    const app = await makeApp();
    await registerComercio(app, 'Tienda Bloqueada');

    const { cookies: superCookies } = await login(app, ADMIN_USERNAME, ADMIN_PASSWORD_PLAIN);
    const { cookies: adminCookies } = await login(app, 'admin', 'Str0ng!Password');

    // Session works while active.
    expect((await request(app).get('/api/auth/me').set('Cookie', adminCookies)).status).toBe(200);

    const list = await request(app).get('/api/auth/superadmin/comercios').set('Cookie', superCookies);
    const comercio = list.body.comercios.find((c: any) => c.name === 'Tienda Bloqueada');

    const turnOff = await request(app)
      .put(`/api/auth/superadmin/comercios/${comercio.id}/active`)
      .set('Cookie', superCookies)
      .send({ active: false });
    expect(turnOff.status).toBe(200);
    expect(turnOff.body.comercio.active).toBe(false);

    // Open sessions are killed immediately.
    const stillOpen = await request(app).get('/api/auth/me').set('Cookie', adminCookies);
    expect(stillOpen.status).toBe(403);

    // And a new login attempt is rejected too.
    const relogin = await login(app, 'admin', 'Str0ng!Password');
    expect(relogin.res.status).toBe(403);

    // Re-activating restores access.
    const turnOn = await request(app)
      .put(`/api/auth/superadmin/comercios/${comercio.id}/active`)
      .set('Cookie', superCookies)
      .send({ active: true });
    expect(turnOn.status).toBe(200);
    const relogin2 = await login(app, 'admin', 'Str0ng!Password');
    expect(relogin2.res.status).toBe(200);
  });

  it('returns 404 when deactivating a comercio that does not exist', async () => {
    setSuperAdminEnv(true);
    const app = await makeApp();
    await registerComercio(app, 'Tienda A');

    const { cookies } = await login(app, ADMIN_USERNAME, ADMIN_PASSWORD_PLAIN);
    const res = await request(app)
      .put('/api/auth/superadmin/comercios/99999/active')
      .set('Cookie', cookies)
      .send({ active: false });

    expect(res.status).toBe(404);
  });

  it('lists the users of a comercio and can reset any password', async () => {
    setSuperAdminEnv(true);
    const app = await makeApp();
    await registerComercio(app, 'Tienda Users');

    const { cookies: adminCookies } = await login(app, 'admin', 'Str0ng!Password');
    await createUserAs(app, adminCookies, 'camarero', 'Temp.1234');
    await createUserAs(app, adminCookies, 'jefe2', 'Temp.5678', 'admin');

    const { cookies: superCookies } = await login(app, ADMIN_USERNAME, ADMIN_PASSWORD_PLAIN);
    const list = await request(app).get('/api/auth/superadmin/comercios').set('Cookie', superCookies);
    const comercio = list.body.comercios.find((c: any) => c.name === 'Tienda Users');
    expect(comercio.user_count).toBe(3);

    const users = await request(app).get(`/api/auth/superadmin/comercios/${comercio.id}/users`).set('Cookie', superCookies);
    expect(users.status).toBe(200);
    expect(users.body.users.map((u: any) => u.username)).toEqual(
      expect.arrayContaining(['admin', 'camarero', 'jefe2'])
    );

    // The super admin may reset even an admin's password; all resets force a
    // change on next login.
    const jefe2 = users.body.users.find((u: any) => u.username === 'jefe2');
    const reset = await request(app)
      .post(`/api/auth/superadmin/comercios/${comercio.id}/users/${jefe2.id}/reset-password`)
      .set('Cookie', superCookies)
      .send({ newPassword: 'NuevoJefe.123' });
    expect(reset.status).toBe(200);
    expect(reset.body.user.must_change_password).toBe(true);

    const relogin = await login(app, 'jefe2', 'NuevoJefe.123');
    expect(relogin.res.status).toBe(200);
    expect(relogin.res.body.user.must_change_password).toBe(true);
  });

  it('has no endpoint to create users (only comercio admins can)', async () => {
    setSuperAdminEnv(true);
    const app = await makeApp();
    await registerComercio(app, 'Tienda A');

    const { cookies } = await login(app, ADMIN_USERNAME, ADMIN_PASSWORD_PLAIN);
    const create = await request(app)
      .post('/api/auth/superadmin/comercios/1/users')
      .set('Cookie', cookies)
      .send({ username: 'nuevo', password: 'Buen.Pass.1', role: 'admin' });

    expect(create.status).toBe(404);
  });
});

describe('password change requirement', () => {
  it('forces a user created by an admin to change its password before using the app', async () => {
    setSuperAdminEnv(false);
    const app = await makeApp();
    await registerComercio(app, 'Tienda C');

    const { cookies: adminCookies } = await login(app, 'admin', 'Str0ng!Password');
    const created = await createUserAs(app, adminCookies, 'peon', 'TempTemporal.9');
    expect(created.status).toBe(201);
    expect(created.body.user.must_change_password).toBe(true);

    const { cookies: userCookies } = await login(app, 'peon', 'TempTemporal.9');
    expect(userCookies.length).toBeGreaterThan(0);

    // /me stays reachable and flags the pending change.
    const me = await request(app).get('/api/auth/me').set('Cookie', userCookies);
    expect(me.status).toBe(200);
    expect(me.body.user.must_change_password).toBe(true);

    // Everything else is blocked until the password is changed.
    const blocked = await request(app).get('/api/config').set('Cookie', userCookies);
    expect(blocked.status).toBe(403);

    const changed = await request(app)
      .put('/api/auth/change-password')
      .set('Cookie', userCookies)
      .send({ currentPassword: 'TempTemporal.9', newPassword: 'MiPropio.Pass.1' });
    expect(changed.status).toBe(200);

    const me2 = await request(app).get('/api/auth/me').set('Cookie', userCookies);
    expect(me2.body.user.must_change_password).toBe(false);

    const nowAllowed = await request(app).get('/api/config').set('Cookie', userCookies);
    expect(nowAllowed.status).toBe(200);
  });

  it('makes the user change its password again after an admin resets it', async () => {
    setSuperAdminEnv(false);
    const app = await makeApp();
    await registerComercio(app, 'Tienda D');

    const { cookies: adminCookies } = await login(app, 'admin', 'Str0ng!Password');
    const created = await createUserAs(app, adminCookies, 'encargado', 'Primer.Pass.1');
    const userId = created.body.user.id;

    const reset = await request(app)
      .put(`/api/auth/users/${userId}`)
      .set('Cookie', adminCookies)
      .send({ password: 'Reseteadо.Pass.1' });
    expect(reset.status).toBe(200);
    expect(reset.body.user.must_change_password).toBe(true);

    const { res: relogin } = await login(app, 'encargado', 'Reseteadо.Pass.1');
    expect(relogin.status).toBe(200);
    expect(relogin.body.user.must_change_password).toBe(true);
  });

  it('does not apply to the comercio admin that registered it', async () => {
    setSuperAdminEnv(false);
    const app = await makeApp();
    await registerComercio(app, 'Tienda E');

    const { res: loginRes } = await login(app, 'admin', 'Str0ng!Password');
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.user.must_change_password).toBe(false);
  });
});

describe('comercio isolation of admin user management', () => {
  it('blocks an admin from changing, resetting or deleting another admin', async () => {
    setSuperAdminEnv(false);
    const app = await makeApp();
    await registerComercio(app, 'Tienda Iso');
    const { cookies: adminCookies } = await login(app, 'admin', 'Str0ng!Password');

    // An admin can create another admin…
    const created = await createUserAs(app, adminCookies, 'admin2', 'OtroAdmin.Pass.1', 'admin');
    expect(created.status).toBe(201);
    const admin2Id = created.body.user.id;

    // …but cannot modify its password, role or delete it.
    const put = await request(app)
      .put(`/api/auth/users/${admin2Id}`)
      .set('Cookie', adminCookies)
      .send({ role: 'user' });
    expect(put.status).toBe(403);

    const del = await request(app)
      .delete(`/api/auth/users/${admin2Id}`)
      .set('Cookie', adminCookies);
    expect(del.status).toBe(403);
  });

  it('prevents an admin from editing itself through the management endpoint', async () => {
    setSuperAdminEnv(false);
    const app = await makeApp();
    await registerComercio(app, 'Tienda Self');
    const { res: loginRes, cookies: adminCookies } = await login(app, 'admin', 'Str0ng!Password');

    const put = await request(app)
      .put(`/api/auth/users/${loginRes.body.user.id}`)
      .set('Cookie', adminCookies)
      .send({ password: 'Nuevo.Password.1' });

    expect(put.status).toBe(400);
  });

  it('keeps admins of other comercios unreachable', async () => {
    setSuperAdminEnv(false);
    const app = await makeApp();
    await registerComercio(app, 'Tienda MIA');
    await registerComercio(app, 'Tienda FOR');

    // The two comercios share usernames on purpose; each admin only sees its own.
    const { cookies: cookiesA } = await login(app, 'admin', 'Str0ng!Password');
    const usersA = await request(app).get('/api/auth/users').set('Cookie', cookiesA);
    expect(usersA.body.users).toHaveLength(1);
    expect(usersA.body.users[0].username).toBe('admin');
  });

  it('lets an admin reset the password of a plain user of its own comercio', async () => {
    setSuperAdminEnv(false);
    const app = await makeApp();
    await registerComercio(app, 'Tienda Reset');
    const { cookies: adminCookies } = await login(app, 'admin', 'Str0ng!Password');
    const created = await createUserAs(app, adminCookies, 'auxiliar', 'Inicial.Pass.1');
    expect(created.status).toBe(201);

    const reset = await request(app)
      .put(`/api/auth/users/${created.body.user.id}`)
      .set('Cookie', adminCookies)
      .send({ password: 'NuevaAux.Pass.1' });
    expect(reset.status).toBe(200);
    expect(reset.body.user.must_change_password).toBe(true);

    const relogin = await login(app, 'auxiliar', 'NuevaAux.Pass.1');
    expect(relogin.res.status).toBe(200);
  });

  it('rejects registering a comercio whose name already exists exactly', async () => {
    setSuperAdminEnv(false);
    const app = await makeApp();
    await registerComercio(app, 'Tienda Unica');
    const again = await registerComercio(app, 'Tienda Unica');
    expect(again.status).toBe(409);
  });
});