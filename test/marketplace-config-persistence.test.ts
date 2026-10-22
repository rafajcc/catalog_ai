// Regression tests for how the per-comercio marketplace credentials are
// persisted:
//
//  - A database whose comercios lack `comercio_marketplaces` rows (created by a
//    build before the normalized schema) is repaired at startup. Before the
//    backfill, findMarketplaceByName() returned undefined, the save wrote
//    nothing and the operator saw "saved" while the PrestaShop key was lost: the
//    connection worked until the next login and then failed again.
//  - Secrets are trimmed before they are stored and the API only returns a
//    masked hint (first and last characters), never the real value.

import request from 'supertest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import createApp from '../backend/src/app';
import {
  createRegistrationNonce,
  generateNonceCode,
  initDatabase,
  listMarketplaces
} from '../backend/src/modules/auth/database';

const initSqlJs = require(require.resolve('sql.js', { paths: [path.join(__dirname, '..', 'backend')] }));

jest.setTimeout(30000);

function extractCookies(res: request.Response): string[] {
  const cookies = (res.headers['set-cookie'] as unknown as string[]) ?? [];
  return cookies.map((c) => c.split(';')[0]);
}

async function registerAdmin(app: Awaited<ReturnType<typeof createApp>>): Promise<string[]> {
  const nonce = createRegistrationNonce(
    generateNonceCode(),
    new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
    'test-root'
  );
  await request(app)
    .post('/api/auth/register-comercio')
    .send({ comercio_name: 'Tienda Persistencia', admin_username: 'admin', admin_password: 'Str0ng!Password', nonce: nonce.code });
  const login = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'Str0ng!Password' });
  return extractCookies(login);
}

async function withTempDir(run: (dataDir: string) => Promise<void>): Promise<void> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'catalogai-persistence-'));
  try {
    await run(dataDir);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

describe('marketplace config persistence', () => {
  it('repairs a legacy database without comercio_marketplaces rows on startup', async () => {
    await withTempDir(async (dataDir) => {
      const app = await createApp({ dataDir });
      const cookies = await registerAdmin(app);

      // Simulate the legacy state: the comercio exists but has no marketplace
      // rows, so every save used to be silently dropped.
      const SQL = await initSqlJs();
      const dbFile = path.join(dataDir, 'catalogai.db');
      const legacyDb = new SQL.Database(fs.readFileSync(dbFile));
      legacyDb.run('DELETE FROM comercio_marketplaces WHERE comercio_id = 1');
      fs.writeFileSync(dbFile, Buffer.from(legacyDb.export()));
      legacyDb.close();

      // Restarting the process runs the idempotent backfill.
      await initDatabase(dataDir);
      expect(listMarketplaces(1).map((m) => m.name).sort()).toEqual(['Mock', 'PrestaShop', 'Shopify']);

      const put = await request(app)
        .put('/api/config')
        .set('Cookie', cookies)
        .send({ prestashop: { base_url: 'https://shop.example.com', api_key: 'ps_key_abcdef', version: '8', language_id: 2 } });
      expect(put.status).toBe(200);
      expect(put.body.prestashop.has_api_key).toBe(true);
      // The save response never leaks the stored secret.
      expect(put.body.prestashop.api_key).toBe('');

      const get = await request(app).get('/api/config').set('Cookie', cookies);
      expect(get.body.prestashop.base_url).toBe('https://shop.example.com');
      expect(get.body.prestashop.has_api_key).toBe(true);
      expect(get.body.prestashop.api_key).toBe('');
      expect(get.body.prestashop.api_key_hint).toBe('ps_••••••••def');
    });
  });

  it('trims the credentials and keeps the stored key when the field is blank', async () => {
    await withTempDir(async (dataDir) => {
      const app = await createApp({ dataDir });
      const cookies = await registerAdmin(app);

      // Key pasted with surrounding whitespace: it is stored trimmed so the
      // Basic authentication is not corrupted.
      await request(app)
        .put('/api/config')
        .set('Cookie', cookies)
        .send({ prestashop: { base_url: ' https://shop.example.com ', api_key: '  ps_key_abcdef  ', version: '1.7', language_id: 1 } })
        .expect(200);

      const first = await request(app).get('/api/config').set('Cookie', cookies);
      expect(first.body.prestashop.base_url).toBe('https://shop.example.com');
      expect(first.body.prestashop.api_key_hint).toBe('ps_••••••••def');

      // Saving the other fields with an empty (masked) key preserves it.
      await request(app)
        .put('/api/config')
        .set('Cookie', cookies)
        .send({ prestashop: { base_url: 'https://shop.example.com', api_key: '', version: '8', language_id: 2 } })
        .expect(200);

      const second = await request(app).get('/api/config').set('Cookie', cookies);
      expect(second.body.prestashop.has_api_key).toBe(true);
      expect(second.body.prestashop.api_key_hint).toBe('ps_••••••••def');
      expect(second.body.prestashop.version).toBe('8');
    });
  });

  it('masks the Shopify token with the same hint', async () => {
    await withTempDir(async (dataDir) => {
      const app = await createApp({ dataDir });
      const cookies = await registerAdmin(app);

      await request(app)
        .put('/api/config')
        .set('Cookie', cookies)
        .send({ shopify: { shop_domain: 'mi-tienda.myshopify.com', access_token: 'shpat_SECRET_TOKEN', api_version: '2026-07' } })
        .expect(200);

      const res = await request(app).get('/api/config').set('Cookie', cookies);
      expect(res.body.shopify.access_token).toBe('');
      expect(res.body.shopify.has_api_key).toBe(true);
      expect(res.body.shopify.api_key_hint).toBe('shp••••••••KEN');
    });
  });
});
