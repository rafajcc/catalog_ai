// Integration tests for the global Shopify app credentials exposed to the
// super admin. They are platform-wide (stored in global_settings), never
// returned in clear text, and only a superadmin may read or change them.

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
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'catalogai-shopify-settings-'));
  tempDirs.push(dataDir);
  return await createApp({ dataDir });
}

async function registerComercio(app: Awaited<ReturnType<typeof createApp>>) {
  const nonce = createRegistrationNonce(
    generateNonceCode(),
    new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
    'test-root'
  );
  const registered = await request(app)
    .post('/api/auth/register-comercio')
    .send({ comercio_name: 'Tienda Uno', admin_username: 'admin', admin_password: 'Str0ng!Password', nonce: nonce.code });
  const login = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'Str0ng!Password' });
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

describe('shopify global settings API', () => {
  it('returns an empty configuration with the default API version', async () => {
    const app = await makeApp();
    const cookies = await loginSuperAdmin(app);

    const res = await request(app).get('/api/superadmin/shopify-settings').set('Cookie', cookies);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      client_id: '',
      has_client_secret: false,
      client_secret_hint: null,
      api_version: '2026-07',
      configured: false
    });
  });

  it('saves the credentials and never returns the secret in clear text', async () => {
    const app = await makeApp();
    const cookies = await loginSuperAdmin(app);

    const saved = await request(app)
      .put('/api/superadmin/shopify-settings')
      .set('Cookie', cookies)
      .send({ client_id: 'shpca_123', client_secret: 'shpss_very_secret_value', api_version: '2025-10' });
    expect(saved.status).toBe(200);
    expect(saved.body.data.client_id).toBe('shpca_123');
    expect(saved.body.data.api_version).toBe('2025-10');
    expect(saved.body.data.configured).toBe(true);
    expect(saved.body.data.client_secret_hint).toContain('••••••••');
    expect(saved.body.data.client_secret_hint).not.toContain('very_secret');

    const reloaded = await request(app).get('/api/superadmin/shopify-settings').set('Cookie', cookies);
    expect(reloaded.body.data.client_id).toBe('shpca_123');
    expect(reloaded.body.data.api_version).toBe('2025-10');
    expect(JSON.stringify(reloaded.body)).not.toContain('shpss_very_secret_value');
  });

  it('keeps the stored values on empty strings and clears them on null', async () => {
    const app = await makeApp();
    const cookies = await loginSuperAdmin(app);

    await request(app)
      .put('/api/superadmin/shopify-settings')
      .set('Cookie', cookies)
      .send({ client_id: 'shpca_123', client_secret: 'shpss_very_secret_value', api_version: '2025-10' });

    const kept = await request(app)
      .put('/api/superadmin/shopify-settings')
      .set('Cookie', cookies)
      .send({ client_id: '', client_secret: '', api_version: '' });
    expect(kept.body.data.client_id).toBe('shpca_123');
    expect(kept.body.data.has_client_secret).toBe(true);
    expect(kept.body.data.api_version).toBe('2025-10');

    const cleared = await request(app)
      .put('/api/superadmin/shopify-settings')
      .set('Cookie', cookies)
      .send({ client_id: null, client_secret: null, api_version: null });
    expect(cleared.body.data).toEqual({
      client_id: '',
      has_client_secret: false,
      client_secret_hint: null,
      api_version: '2026-07',
      configured: false
    });
  });

  it('rejects an API version outside the YYYY-MM format', async () => {
    const app = await makeApp();
    const cookies = await loginSuperAdmin(app);

    const bad = await request(app)
      .put('/api/superadmin/shopify-settings')
      .set('Cookie', cookies)
      .send({ api_version: '2026-13' });
    expect(bad.status).toBe(400);

    const freeText = await request(app)
      .put('/api/superadmin/shopify-settings')
      .set('Cookie', cookies)
      .send({ api_version: 'latest' });
    expect(freeText.status).toBe(400);
  });

  it('denies the routes to anonymous users and regular comercio admins', async () => {
    const app = await makeApp();
    const anonymous = await request(app).get('/api/superadmin/shopify-settings');
    expect(anonymous.status).toBe(401);

    const { cookies: comercioCookies } = await registerComercio(app);
    const get = await request(app).get('/api/superadmin/shopify-settings').set('Cookie', comercioCookies);
    expect(get.status).toBe(403);

    const put = await request(app)
      .put('/api/superadmin/shopify-settings')
      .set('Cookie', comercioCookies)
      .send({ client_id: 'stolen' });
    expect(put.status).toBe(403);
  });
});
