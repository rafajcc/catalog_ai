// Tests for the comercio API keys: generation/hashing, the super admin CRUD and
// the requireApiKey middleware that authenticates machine-to-machine requests.
//
// The CRUD/middleware tests boot a real app like autocomplete-quota.test.ts does,
// registering a comercio through the public flow and acting as the super admin.

import request from 'supertest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import createApp from '../backend/src/app';
import { hashPassword } from '../backend/src/modules/auth/auth';
import { initDatabase } from '../backend/src/modules/auth';
import {
  createRegistrationNonce,
  generateNonceCode,
  findComercioApiKeyByHash,
  listComercioApiKeys
} from '../backend/src/modules/auth/database';
import { apiKeyPrefix, generateApiKey, hashApiKey } from '../backend/src/modules/api-keys/api-key';

jest.setTimeout(30000);

const ADMIN_USERNAME = 'root';
const ADMIN_PASSWORD_PLAIN = 'Super.Admin.1';
let adminPasswordHash = '';

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function resetDb() {
  await initDatabase(makeTempDir('catalogai-apikeys-'));
}

beforeAll(async () => {
  adminPasswordHash = await hashPassword(ADMIN_PASSWORD_PLAIN);
});

afterAll(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('api key generation and hashing', () => {
  it('generates a prefixed, url-safe random secret', () => {
    const key = generateApiKey();
    expect(key.startsWith('ck_live_')).toBe(true);
    // base64url alphabet: no '+', '/' or '=' that would need escaping in headers.
    expect(key).toMatch(/^ck_live_[A-Za-z0-9_-]+$/);
    expect(key).not.toBe(generateApiKey());
  });

  it('hashes deterministically and never returns the secret', () => {
    const key = generateApiKey();
    expect(hashApiKey(key)).toBe(hashApiKey(key));
    expect(hashApiKey(key)).not.toContain(key);
    expect(hashApiKey(key)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashApiKey('a')).not.toBe(hashApiKey('b'));
  });

  it('keeps a short identifying prefix of the key', () => {
    const key = generateApiKey();
    const prefix = apiKeyPrefix(key);
    expect(key.startsWith(prefix)).toBe(true);
    expect(prefix.length).toBeLessThan(key.length);
  });
});

describe('comercio api keys storage', () => {
  it('stores only the hash, never the plaintext secret', async () => {
    await resetDb();
    const secret = generateApiKey();
    const hash = hashApiKey(secret);
    const { createComercioApiKey } = require('../backend/src/modules/auth/database');
    createComercioApiKey({ comercioId: 1, name: 'Módulo PrestaShop', keyHash: hash, keyPrefix: apiKeyPrefix(secret) });

    const stored = findComercioApiKeyByHash(hash);
    expect(stored).toBeTruthy();
    expect(stored!.key_hash).toBe(hash);
    // The secret itself is nowhere in the row.
    expect(JSON.stringify(stored)).not.toContain(secret);
  });
});

describe('comercio api keys super admin API', () => {
  function extractCookies(res: request.Response): string[] {
    const cookies = (res.headers['set-cookie'] as unknown as string[]) ?? [];
    return cookies.map((c) => c.split(';')[0]);
  }

  async function makeApp() {
    return createApp({ dataDir: makeTempDir('catalogai-apikeys-api-') });
  }

  function setSuperAdminEnv(enabled: boolean) {
    if (enabled) {
      process.env.ADMIN_USER = ADMIN_USERNAME;
      process.env.ADMIN_PASSWORD = adminPasswordHash;
    } else {
      delete process.env.ADMIN_USER;
      delete process.env.ADMIN_PASSWORD;
    }
  }

  async function loginAsSuperAdmin(app: Awaited<ReturnType<typeof createApp>>) {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD_PLAIN });
    return extractCookies(res);
  }

  async function registerComercio(app: Awaited<ReturnType<typeof createApp>>, name: string) {
    const nonce = createRegistrationNonce(
      generateNonceCode(),
      new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
      'test-root'
    );
    await request(app).post('/api/auth/register-comercio').send({
      comercio_name: name,
      admin_username: 'admin',
      admin_password: 'Str0ng!Password',
      nonce: nonce.code
    });
    const login = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'Str0ng!Password' });
    return extractCookies(login);
  }

  async function comercioIdOf(app: Awaited<ReturnType<typeof createApp>>, adminCookies: string[], name: string) {
    const listed = await request(app).get('/api/auth/superadmin/comercios').set('Cookie', adminCookies);
    return listed.body.comercios.find((c: any) => c.name === name).id;
  }

  it('creates a key and returns the secret exactly once', async () => {
    setSuperAdminEnv(false);
    const app = await makeApp();
    await registerComercio(app, 'Tienda Keys');
    setSuperAdminEnv(true);
    const adminCookies = await loginAsSuperAdmin(app);
    const comercioId = await comercioIdOf(app, adminCookies, 'Tienda Keys');

    const created = await request(app)
      .post(`/api/superadmin/comercios/${comercioId}/keys`)
      .set('Cookie', adminCookies)
      .send({ name: 'Módulo PrestaShop' });

    expect(created.status).toBe(201);
    expect(created.body.data.secret).toMatch(/^ck_live_/);
    expect(created.body.data.key_prefix).toBe(apiKeyPrefix(created.body.data.secret));
    // The response carries the identifying prefix but never the hash.
    expect(created.body.data.key_hash).toBeUndefined();

    // Listing afterwards exposes the prefix but never the secret again.
    const listed = await request(app)
      .get(`/api/superadmin/comercios/${comercioId}/keys`)
      .set('Cookie', adminCookies);
    expect(listed.status).toBe(200);
    expect(listed.body.data.keys).toHaveLength(1);
    expect(listed.body.data.keys[0].key_prefix).toBe(created.body.data.key_prefix);
    expect(JSON.stringify(listed.body)).not.toContain(created.body.data.secret);
  });

  it('rejects a key without a name and a comercio that does not exist', async () => {
    setSuperAdminEnv(false);
    const app = await makeApp();
    await registerComercio(app, 'Tienda Valid');
    setSuperAdminEnv(true);
    const adminCookies = await loginAsSuperAdmin(app);
    const comercioId = await comercioIdOf(app, adminCookies, 'Tienda Valid');

    const noName = await request(app)
      .post(`/api/superadmin/comercios/${comercioId}/keys`)
      .set('Cookie', adminCookies)
      .send({});
    expect(noName.status).toBe(400);

    const missing = await request(app)
      .post('/api/superadmin/comercios/9999/keys')
      .set('Cookie', adminCookies)
      .send({ name: 'x' });
    expect(missing.status).toBe(404);
  });

  it('revokes a key and refuses to revoke it twice', async () => {
    setSuperAdminEnv(false);
    const app = await makeApp();
    await registerComercio(app, 'Tienda Revoke');
    setSuperAdminEnv(true);
    const adminCookies = await loginAsSuperAdmin(app);
    const comercioId = await comercioIdOf(app, adminCookies, 'Tienda Revoke');

    const created = await request(app)
      .post(`/api/superadmin/comercios/${comercioId}/keys`)
      .set('Cookie', adminCookies)
      .send({ name: 'App Shopify' });
    const keyId = created.body.data.id;

    const revoked = await request(app)
      .delete(`/api/superadmin/comercios/${comercioId}/keys/${keyId}`)
      .set('Cookie', adminCookies);
    expect(revoked.status).toBe(200);

    const again = await request(app)
      .delete(`/api/superadmin/comercios/${comercioId}/keys/${keyId}`)
      .set('Cookie', adminCookies);
    expect(again.status).toBe(404);

    // The revoked row is kept (audit trail) but marked revoked.
    const rows = listComercioApiKeys(comercioId);
    expect(rows).toHaveLength(1);
    expect(rows[0].revoked_at).not.toBeNull();
  });

  it('denies the key management routes to a regular comercio admin', async () => {
    setSuperAdminEnv(false);
    const app = await makeApp();
    const comercioCookies = await registerComercio(app, 'Tienda Normal');

    const res = await request(app).get('/api/superadmin/comercios/1/keys').set('Cookie', comercioCookies);
    expect(res.status).toBe(403);
  });
});

describe('requireApiKey middleware', () => {
  async function bootWithKey(comercioName = 'Tienda Pública') {
    process.env.ADMIN_USER = ADMIN_USERNAME;
    process.env.ADMIN_PASSWORD = adminPasswordHash;
    const app = await createApp({ dataDir: makeTempDir('catalogai-apikey-mw-') });

    // Register the comercio through the public flow.
    const nonce = createRegistrationNonce(
      generateNonceCode(),
      new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
      'test-root'
    );
    await request(app).post('/api/auth/register-comercio').send({
      comercio_name: comercioName,
      admin_username: 'admin',
      admin_password: 'Str0ng!Password',
      nonce: nonce.code
    });

    const login = await request(app).post('/api/auth/login').send({
      username: ADMIN_USERNAME,
      password: ADMIN_PASSWORD_PLAIN
    });
    const adminCookies = extractCookies(login);
    const listed = await request(app).get('/api/auth/superadmin/comercios').set('Cookie', adminCookies);
    const comercioId = listed.body.comercios.find((c: any) => c.name === comercioName).id;

    const created = await request(app)
      .post(`/api/superadmin/comercios/${comercioId}/keys`)
      .set('Cookie', adminCookies)
      .send({ name: 'Módulo' });

    return { app, secret: created.body.data.secret as string, comercioId: comercioId as number };
  }

  function extractCookies(res: request.Response): string[] {
    const cookies = (res.headers['set-cookie'] as unknown as string[]) ?? [];
    return cookies.map((c) => c.split(';')[0]);
  }

  it('rejects a request with no key', async () => {
    const { app } = await bootWithKey();
    const res = await request(app).get('/api/public/probe');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('invalid_api_key');
  });

  it('rejects a request with an unknown key', async () => {
    const { app } = await bootWithKey();
    const res = await request(app).get('/api/public/probe').set('Authorization', 'Bearer ck_live_nope');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('invalid_api_key');
  });

  it('accepts a valid key and resolves the comercio config', async () => {
    const { app, secret, comercioId } = await bootWithKey();
    const res = await request(app).get('/api/public/probe').set('X-Api-Key', secret);
    expect(res.status).toBe(200);
    expect(res.body.data.comercio_id).toBe(comercioId);
    expect(res.body.data.has_store).toBe(true);
  });

  it('accepts the same key through the Authorization header', async () => {
    const { app, secret } = await bootWithKey();
    const res = await request(app).get('/api/public/probe').set('Authorization', `Bearer ${secret}`);
    expect(res.status).toBe(200);
  });
});
