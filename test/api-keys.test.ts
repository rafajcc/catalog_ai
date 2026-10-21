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
  async function bootWithKey(
    comercioName = 'Tienda Pública',
    options: Parameters<typeof createApp>[0] = {}
  ) {
    process.env.ADMIN_USER = ADMIN_USERNAME;
    process.env.ADMIN_PASSWORD = adminPasswordHash;
    const app = await createApp({ dataDir: makeTempDir('catalogai-apikey-mw-'), ...options });

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

    return { app, secret: created.body.data.secret as string, comercioId: comercioId as number, adminCookies };
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

describe('public API endpoints', () => {
  async function bootWithKey(
    comercioName = 'Tienda Pública',
    options: Parameters<typeof createApp>[0] = {}
  ) {
    process.env.ADMIN_USER = ADMIN_USERNAME;
    process.env.ADMIN_PASSWORD = adminPasswordHash;
    const app = await createApp({ dataDir: makeTempDir('catalogai-apikey-pub-'), ...options });

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

    return { app, secret: created.body.data.secret as string, comercioId: comercioId as number, adminCookies };
  }

  function extractCookies(res: request.Response): string[] {
    const cookies = (res.headers['set-cookie'] as unknown as string[]) ?? [];
    return cookies.map((c) => c.split(';')[0]);
  }

  function emptyProduct(reference: string) {
    return {
      language: 'es',
      product: {
        id: 'p1',
        status: 'pending',
        source_file: 'PrestaShop',
        validation_errors: [],
        warnings: [],
        reference,
        brand: 'Nike',
        description: '',
        description_short: '',
        meta_title: '',
        meta_description: ''
      }
    };
  }

  it('reports online status for the comercio of the key', async () => {
    const { app, secret, comercioId } = await bootWithKey();
    const res = await request(app).get('/api/public/status').set('X-Api-Key', secret);
    expect(res.status).toBe(200);
    expect(res.body.data.online).toBe(true);
    expect(res.body.data.comercio_id).toBe(comercioId);
  });

  it('reports the quota of the comercio, disabled by default', async () => {
    const { app, secret } = await bootWithKey();
    const res = await request(app).get('/api/public/quota').set('X-Api-Key', secret);
    expect(res.status).toBe(200);
    expect(res.body.data.disabled).toBe(true);
    expect(res.body.data.remaining).toBe(0);
  });

  it('reflects a configured quota and consumes it through autocomplete', async () => {
    const imageSearchSpy = jest.fn().mockResolvedValue({ urls: [], source: null, attempts: [] });
    const { app, secret, comercioId, adminCookies } = await bootWithKey('Tienda Pública Cuota', {
      imageSearcher: imageSearchSpy
    });

    await request(app)
      .put(`/api/superadmin/autocomplete-quota/${comercioId}`)
      .set('Cookie', adminCookies)
      .send({ monthly_limit: 2, billing_cycle_day: 1 });

    const before = await request(app).get('/api/public/quota').set('X-Api-Key', secret);
    expect(before.body.data.remaining).toBe(2);
    expect(before.body.data.disabled).toBe(false);

    const ac = await request(app).post('/api/public/autocomplete').set('X-Api-Key', secret).send(emptyProduct('REF-API-1'));
    expect(ac.status).toBe(200);
    expect(ac.body.data.proposals).toBeTruthy();
    // The public call reached the image search exactly as the web route would.
    expect(imageSearchSpy).toHaveBeenCalledTimes(1);

    const after = await request(app).get('/api/public/quota').set('X-Api-Key', secret);
    expect(after.body.data.calls_this_cycle).toBe(1);
    expect(after.body.data.remaining).toBe(1);
  });

  it('blocks the public autocomplete with 429 once the quota is exhausted', async () => {
    const imageSearchSpy = jest.fn().mockResolvedValue({ urls: [], source: null, attempts: [] });
    const { app, secret, comercioId, adminCookies } = await bootWithKey('Tienda Pública Limite', {
      imageSearcher: imageSearchSpy
    });

    await request(app)
      .put(`/api/superadmin/autocomplete-quota/${comercioId}`)
      .set('Cookie', adminCookies)
      .send({ monthly_limit: 1, billing_cycle_day: 1 });

    const first = await request(app).post('/api/public/autocomplete').set('X-Api-Key', secret).send(emptyProduct('REF-1'));
    expect(first.status).toBe(200);

    const blocked = await request(app).post('/api/public/autocomplete').set('X-Api-Key', secret).send(emptyProduct('REF-2'));
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('autocomplete_quota_exceeded');
    // The blocked call never reached the image search.
    expect(imageSearchSpy).toHaveBeenCalledTimes(1);
  });

  it('shares the quota between the web app and the public API', async () => {
    const imageSearchSpy = jest.fn().mockResolvedValue({ urls: [], source: null, attempts: [] });
    const { app, secret, comercioId, adminCookies } = await bootWithKey('Tienda Compartida', {
      imageSearcher: imageSearchSpy
    });

    await request(app)
      .put(`/api/superadmin/autocomplete-quota/${comercioId}`)
      .set('Cookie', adminCookies)
      .send({ monthly_limit: 2, billing_cycle_day: 1 });

    // Log in as the comercio admin and spend one call through the WEB route.
    const comercioLogin = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'Str0ng!Password' });
    const comercioCookies = extractCookies(comercioLogin);

    const web = await request(app).post('/api/autocomplete').set('Cookie', comercioCookies).send(emptyProduct('REF-WEB'));
    expect(web.status).toBe(200);

    // The public API now sees the same counter and has one call left.
    const quota = await request(app).get('/api/public/quota').set('X-Api-Key', secret);
    expect(quota.body.data.calls_this_cycle).toBe(1);
    expect(quota.body.data.remaining).toBe(1);

    const api = await request(app).post('/api/public/autocomplete').set('X-Api-Key', secret).send(emptyProduct('REF-API'));
    expect(api.status).toBe(200);

    const blockedWeb = await request(app).post('/api/autocomplete').set('Cookie', comercioCookies).send(emptyProduct('REF-WEB-2'));
    expect(blockedWeb.status).toBe(429);
  });

  it('rejects the public autocomplete without a product', async () => {
    const { app, secret } = await bootWithKey();
    const res = await request(app).post('/api/public/autocomplete').set('X-Api-Key', secret).send({});
    expect(res.status).toBe(400);
  });
});
