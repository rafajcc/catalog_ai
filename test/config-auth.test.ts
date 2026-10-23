// Security regression tests for the configuration endpoint's authentication.
// Unlike api-routes.test.ts, this file does NOT mock the auth middleware, so the
// real requireAuth runs against a real temp database: GET /api/config must be
// unreachable without a session (the app config is comercio-scoped and includes
// the shop base URL, the AI provider basere URL and the stored default prompt,
// so it must never be served to anonymous requests), and even authenticated it
// always returns API keys masked.

import request from 'supertest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import createApp from '../backend/src/app';
import { createRegistrationNonce, generateNonceCode } from '../backend/src/modules/auth/database';

// Boots a fresh Express app (with its own temp SQLite database) and performs a
// bcrypt login, so give the file a larger budget than the 5 s default.
jest.setTimeout(30000);

const tempDirs: string[] = [];

function extractCookies(res: request.Response): string[] {
  const cookies = (res.headers['set-cookie'] as unknown as string[]) ?? [];
  return cookies.map((c) => c.split(';')[0]);
}

async function makeApp() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'catalogai-config-auth-'));
  tempDirs.push(dataDir);
  return await createApp({ dataDir });
}

async function registerAndLogin(app: Awaited<ReturnType<typeof createApp>>) {
  const nonce = createRegistrationNonce(
    generateNonceCode(),
    new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
    'test-root'
  );
  await request(app)
    .post('/api/auth/register-comercio')
    .send({ comercio_name: 'Tienda Config', admin_username: 'admin', admin_password: 'Str0ng!Password', nonce: nonce.code });
  const login = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'Str0ng!Password' });
  return login;
}

describe('config endpoint authentication', () => {
  afterAll(() => {
    for (const dir of tempDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects GET /api/config without an access token', async () => {
    const app = await makeApp();
    const res = await request(app).get('/api/config');
    expect(res.status).toBe(401);
    expect(res.body.error.message).toMatch(/authentication required/i);
  });

  it('rejects GET /api/config with an arbitrary invalid token', async () => {
    const app = await makeApp();
    const res = await request(app).get('/api/config').set('Cookie', 'access_token=not-a-real-jwt');
    expect(res.status).toBe(401);
  });

  it('serves the masked configuration to an authenticated admin', async () => {
    const app = await makeApp();
    const login = await registerAndLogin(app);
    expect(login.status).toBe(200);

    const res = await request(app).get('/api/config').set('Cookie', extractCookies(login));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.ai).toBeDefined();
    // API keys are never exposed, even to authenticated users.
    expect(res.body.ai.api_key).toBe('');
    expect(res.body.ai.providers.openai.api_key).toBe('');
  });

  it('masks the Shopify token even for an authenticated admin', async () => {
    const app = await makeApp();
    const login = await registerAndLogin(app);
    const cookies = extractCookies(login);

    await request(app)
      .put('/api/config')
      .set('Cookie', cookies)
      .send({ shopify: { shop_domain: 'mi-tienda.myshopify.com', access_token: 'shpat_SECRET', api_version: '2026-07' } })
      .expect(200);

    const res = await request(app).get('/api/config').set('Cookie', cookies);
    expect(res.status).toBe(200);
    expect(res.body.shopify.access_token).toBe('');
    expect(res.body.shopify.has_api_key).toBe(true);
    expect(res.body.shopify.api_key_hint).toBe('shp••••••••RET');
    expect(res.body.shopify.shop_domain).toBe('mi-tienda.myshopify.com');
  });

  it('trims the PrestaShop key and exposes only a masked hint of it', async () => {
    const app = await makeApp();
    const login = await registerAndLogin(app);
    const cookies = extractCookies(login);

    const saved = await request(app)
      .put('/api/config')
      .set('Cookie', cookies)
      .send({
        prestashop: { base_url: 'https://shop.example.com', api_key: '  ps_key_abcdef  ', version: '8', language_id: 2 }
      });
    expect(saved.status).toBe(200);
    // The save response is masked too, so the key never round-trips.
    expect(saved.body.prestashop.api_key).toBe('');
    expect(saved.body.prestashop.api_key_hint).toBe('ps_••••••••def');

    const res = await request(app).get('/api/config').set('Cookie', cookies);
    expect(res.status).toBe(200);
    expect(res.body.prestashop.api_key).toBe('');
    expect(res.body.prestashop.has_api_key).toBe(true);
    expect(res.body.prestashop.api_key_hint).toBe('ps_••••••••def');

    // Saving the rest of the fields with a blank key keeps the stored one.
    await request(app)
      .put('/api/config')
      .set('Cookie', cookies)
      .send({ prestashop: { base_url: 'https://shop.example.com', api_key: '', version: '1.7', language_id: 1 } })
      .expect(200);

    const after = await request(app).get('/api/config').set('Cookie', cookies);
    expect(after.body.prestashop.has_api_key).toBe(true);
    expect(after.body.prestashop.api_key_hint).toBe('ps_••••••••def');
    expect(after.body.prestashop.version).toBe('1.7');
  });

  it('forbids a role "user" from modifying the Shopify configuration or the active marketplace', async () => {
    const app = await makeApp();
    const admin = await registerAndLogin(app);
    const adminCookies = extractCookies(admin);

    const created = await request(app)
      .post('/api/auth/users')
      .set('Cookie', adminCookies)
      .send({ username: 'camarero', password: 'Empl3ado!Pass', role: 'user' });
    expect([200, 201]).toContain(created.status);

    const userLogin = await request(app)
      .post('/api/auth/login')
      .send({ username: 'camarero', password: 'Empl3ado!Pass' });
    const userCookies = extractCookies(userLogin);

    // The admin-chosen temporary password must be rotated before the account can
    // use the rest of the platform (otherwise every call below would be a 403
    // for "password change required").
    await request(app)
      .put('/api/auth/change-password')
      .set('Cookie', userCookies)
      .send({ currentPassword: 'Empl3ado!Pass', newPassword: 'Empl3ado!Pass2' })
      .expect(200);

    // The user cannot touch the Shopify section...
    const shopifyRes = await request(app)
      .put('/api/config')
      .set('Cookie', userCookies)
      .send({ shopify: { access_token: 'shpat_HACK' } });
    expect(shopifyRes.status).toBe(403);

    // ...nor switch the active marketplace.
    const marketplaceRes = await request(app)
      .put('/api/config')
      .set('Cookie', userCookies)
      .send({ active_marketplace: 'Shopify' });
    expect(marketplaceRes.status).toBe(403);

    // The custom prompt remains editable (the AI provider itself is global and
    // owned by the super admin, so a comercio user can no longer set it).
    const aiRes = await request(app)
      .put('/api/config')
      .set('Cookie', userCookies)
      .send({ ai: { default_prompt: 'prompt del usuario' } });
    expect(aiRes.status).toBe(200);

    // Nothing leaked through: the token was never stored and the marketplace is
    // still the default.
    const check = await request(app).get('/api/config').set('Cookie', adminCookies);
    expect(check.body.shopify.has_api_key).toBe(false);
    expect(check.body.active_marketplace).toBe('PrestaShop');
  });
});