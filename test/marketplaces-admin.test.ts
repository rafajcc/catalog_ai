// Integration tests for the platform-wide marketplace switch exposed to the
// super admin. The switch is global (one row per marketplace), so disabling a
// marketplace must remove it from every comercio selector while keeping the
// comercios that already had it as their active one pointed at it but unable to
// operate. These tests boot a real app with real auth and a temp database.

import request from 'supertest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import createApp from '../backend/src/app';
import { hashPassword } from '../backend/src/modules/auth/auth';
import { createRegistrationNonce, generateNonceCode } from '../backend/src/modules/auth/database';

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
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'catalogai-marketplaces-'));
  tempDirs.push(dataDir);
  return await createApp({ dataDir });
}

async function registerComercio(app: Awaited<ReturnType<typeof createApp>>, name: string, username = 'admin', password = 'Str0ng!Password') {
  const nonce = createRegistrationNonce(
    generateNonceCode(),
    new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
    'test-root'
  );
  const registered = await request(app)
    .post('/api/auth/register-comercio')
    .send({ comercio_name: name, admin_username: username, admin_password: password, nonce: nonce.code });
  const login = await request(app).post('/api/auth/login').send({ username, password });
  return { registered, cookies: extractCookies(login) };
}

async function loginSuperAdmin(app: Awaited<ReturnType<typeof createApp>>) {
  process.env.ADMIN_USER = ADMIN_USERNAME;
  process.env.ADMIN_PASSWORD = adminPasswordHash;
  const res = await request(app).post('/api/auth/login').send({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD_PLAIN });
  return extractCookies(res);
}

beforeAll(async () => {
  adminPasswordHash = await hashPassword(ADMIN_PASSWORD_PLAIN);
});

afterAll(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('marketplaces super admin API', () => {
  it('lists every marketplace enabled by default', async () => {
    const app = await makeApp();
    const cookies = await loginSuperAdmin(app);

    const res = await request(app).get('/api/superadmin/marketplaces').set('Cookie', cookies);
    expect(res.status).toBe(200);
    expect(res.body.data.map((m: any) => m.name).sort()).toEqual(['Mock', 'PrestaShop', 'Shopify']);
    for (const m of res.body.data) {
      expect(m.enabled).toBe(true);
      expect(Array.isArray(m.in_use_by)).toBe(true);
    }
  });

  it('disables a marketplace and reports the comercios that use it', async () => {
    const app = await makeApp();
    await registerComercio(app, 'Tienda A');
    const cookies = await loginSuperAdmin(app);

    const res = await request(app)
      .put('/api/superadmin/marketplaces/Mock')
      .set('Cookie', cookies)
      .send({ enabled: false });
    expect(res.status).toBe(200);
    expect(res.body.data.enabled).toBe(false);

    const list = await request(app).get('/api/superadmin/marketplaces').set('Cookie', cookies);
    const mock = list.body.data.find((m: any) => m.name === 'Mock');
    expect(mock.enabled).toBe(false);
    // A comercio with no explicit active marketplace defaults to PrestaShop, so
    // Mock is not in use yet.
    expect(mock.in_use_by).toEqual([]);
  });

  it('rejects an unknown marketplace and a non-boolean flag', async () => {
    const app = await makeApp();
    const cookies = await loginSuperAdmin(app);

    const unknown = await request(app)
      .put('/api/superadmin/marketplaces/Nope')
      .set('Cookie', cookies)
      .send({ enabled: false });
    expect(unknown.status).toBe(400);

    const badFlag = await request(app)
      .put('/api/superadmin/marketplaces/Mock')
      .set('Cookie', cookies)
      .send({ enabled: 'yes' });
    expect(badFlag.status).toBe(400);
  });

  it('reports the comercios using a marketplace when disabling it', async () => {
    const app = await makeApp();
    const { cookies: comercioCookies } = await registerComercio(app, 'Tienda Mock', 'admin', 'Str0ng!Password');

    // The comercio picks Mock as its active marketplace.
    const save = await request(app)
      .put('/api/config')
      .set('Cookie', comercioCookies)
      .send({ active_marketplace: 'Mock' });
    expect(save.status).toBe(200);

    const cookies = await loginSuperAdmin(app);
    const res = await request(app)
      .put('/api/superadmin/marketplaces/Mock')
      .set('Cookie', cookies)
      .send({ enabled: false });
    expect(res.status).toBe(200);
    expect(res.body.data.affected_comercios.map((c: any) => c.name)).toContain('Tienda Mock');
  });

  it('refuses to let a comercio pick a disabled marketplace', async () => {
    const app = await makeApp();
    const { cookies: comercioCookies } = await registerComercio(app, 'Tienda B');

    const cookies = await loginSuperAdmin(app);
    await request(app)
      .put('/api/superadmin/marketplaces/Mock')
      .set('Cookie', cookies)
      .send({ enabled: false });

    const save = await request(app)
      .put('/api/config')
      .set('Cookie', comercioCookies)
      .send({ active_marketplace: 'Mock' });
    expect(save.status).toBe(403);
  });

  it('reports the enabled state of the active marketplace through /api/auth/me', async () => {
    const app = await makeApp();
    const { cookies: comercioCookies } = await registerComercio(app, 'Tienda C');

    await request(app).put('/api/config').set('Cookie', comercioCookies).send({ active_marketplace: 'Mock' });

    const before = await request(app).get('/api/auth/me').set('Cookie', comercioCookies);
    expect(before.body.user.active_marketplace).toBe('Mock');
    expect(before.body.user.active_marketplace_enabled).toBe(true);

    const cookies = await loginSuperAdmin(app);
    await request(app).put('/api/superadmin/marketplaces/Mock').set('Cookie', cookies).send({ enabled: false });

    const after = await request(app).get('/api/auth/me').set('Cookie', comercioCookies);
    // The comercio keeps its value, but is now flagged as unusable.
    expect(after.body.user.active_marketplace).toBe('Mock');
    expect(after.body.user.active_marketplace_enabled).toBe(false);
  });

  it('blocks the operations against a marketplace disabled platform-wide', async () => {
    const app = await makeApp();
    const { cookies: comercioCookies } = await registerComercio(app, 'Tienda E');
    await request(app).put('/api/config').set('Cookie', comercioCookies).send({ active_marketplace: 'Mock' });

    const cookies = await loginSuperAdmin(app);
    await request(app).put('/api/superadmin/marketplaces/Mock').set('Cookie', cookies).send({ enabled: false });

    // The frontend already hides the fetch button, but the API must refuse the
    // operation on its own so a direct request cannot use a disabled marketplace.
    const fetchRes = await request(app).post('/api/fetch/mock').set('Cookie', comercioCookies).send({});
    expect(fetchRes.status).toBe(403);
    expect(fetchRes.body.error.message).toMatch(/desactivado/i);

    const saveRes = await request(app)
      .post('/api/fetch/mock/save')
      .set('Cookie', comercioCookies)
      .send({ updates: { '1': { description: 'nuevo' } } });
    expect(saveRes.status).toBe(403);

    const testRes = await request(app).post('/api/config/test/mock').set('Cookie', comercioCookies).send({});
    expect(testRes.status).toBe(403);
  });

  it('denies the marketplace routes to a regular comercio admin', async () => {
    const app = await makeApp();
    const { cookies: comercioCookies } = await registerComercio(app, 'Tienda D');

    const get = await request(app).get('/api/superadmin/marketplaces').set('Cookie', comercioCookies);
    expect(get.status).toBe(403);

    const put = await request(app)
      .put('/api/superadmin/marketplaces/Mock')
      .set('Cookie', comercioCookies)
      .send({ enabled: false });
    expect(put.status).toBe(403);
  });
});
