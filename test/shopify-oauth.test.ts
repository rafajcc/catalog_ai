// Integration tests for the per-comercio Shopify OAuth installation. The
// comercio only saves its shop domain and, optionally, its own app credentials;
// the backend owns the tokens, refreshes them and never exposes them to the
// browser.

import request from 'supertest';
import axios from 'axios';
import fs from 'fs';
import os from 'os';
import path from 'path';
import createApp from '../backend/src/app';
import { hashPassword } from '../backend/src/modules/auth/auth';
import { createRegistrationNonce, generateNonceCode } from '../backend/src/modules/auth/database';
import { DatabasePersistence } from '../backend/src/modules/database-persistence/database-persistence';
import { prepareShopifyRuntimeConfig } from '../backend/src/modules/shopify-settings/token-service';

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
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'catalogai-shopify-oauth-'));
  tempDirs.push(dataDir);
  return await createApp({ dataDir });
}

async function registerComercio(app: Awaited<ReturnType<typeof createApp>>) {
  const nonce = createRegistrationNonce(
    generateNonceCode(),
    new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
    'test-oauth'
  );
  const registered = await request(app)
    .post('/api/auth/register-comercio')
    .send({ comercio_name: 'Tienda OAuth', admin_username: 'admin', admin_password: 'Str0ng!Password', nonce: nonce.code });
  const login = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'Str0ng!Password' });
  return { registered, cookies: extractCookies(login) };
}

async function loginSuperAdmin(app: Awaited<ReturnType<typeof createApp>>) {
  process.env.ADMIN_USER = ADMIN_USERNAME;
  process.env.ADMIN_PASSWORD = adminPasswordHash;
  const res = await request(app).post('/api/auth/login').send({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD_PLAIN });
  return extractCookies(res);
}

async function setGlobalCredentials(
  app: Awaited<ReturnType<typeof createApp>>,
  cookies: string[],
  overrides: Record<string, unknown> = {}
) {
  return request(app)
    .put('/api/superadmin/shopify-settings')
    .set('Cookie', cookies)
    .send({ client_id: 'shpca_global', client_secret: 'shpss_global_secret', api_version: '2026-07', ...overrides });
}

async function configureShop(
  app: Awaited<ReturnType<typeof createApp>>,
  cookies: string[],
  shopify: Record<string, unknown>
) {
  return request(app).put('/api/config').set('Cookie', cookies).send({ shopify });
}

const DEFAULT_TOKENS = {
  access_token: 'token_abc',
  refresh_token: 'refresh_abc',
  scope: 'read_products,write_products,write_files',
  expires_in: 3600,
  refresh_token_expires_in: 7776000
};

// Starts the flow as the logged-in admin and returns the state Shopify would
// send back to the callback.
async function startOAuth(
  app: Awaited<ReturnType<typeof createApp>>,
  cookies: string[],
  headers: Record<string, string> = {}
): Promise<{ response: request.Response; state: string | null }> {
  const response = await request(app)
    .get('/api/shopify/oauth/start')
    .set('Cookie', cookies)
    .set(headers);
  const state = response.headers.location ? new URL(response.headers.location).searchParams.get('state') : null;
  return { response, state };
}

beforeAll(async () => {
  adminPasswordHash = await hashPassword(ADMIN_PASSWORD_PLAIN);
});

afterAll(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('shopify oauth flow', () => {
  let post: jest.SpyInstance;

  beforeEach(() => {
    post = jest.spyOn(axios, 'post').mockResolvedValue({ data: { ...DEFAULT_TOKENS } });
  });

  afterEach(() => {
    post.mockRestore();
    delete process.env.SHOPIFY_REDIRECT_URI;
  });

  it('starts the authorize flow with the global app and a redirect URI derived from the request', async () => {
    const app = await makeApp();
    const superCookies = await loginSuperAdmin(app);
    await setGlobalCredentials(app, superCookies);
    const { cookies } = await registerComercio(app);
    await configureShop(app, cookies, { shop_domain: ' tienda.myshopify.com ' });

    const { response, state } = await startOAuth(app, cookies, {
      Host: 'catalog.example.com',
      'X-Forwarded-Proto': 'https'
    });

    expect(response.status).toBe(302);
    const url = new URL(response.headers.location);
    expect(url.origin + url.pathname).toBe('https://tienda.myshopify.com/admin/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe('shpca_global');
    expect(url.searchParams.get('scope')).toBe('read_products,write_products,write_files');
    expect(url.searchParams.get('redirect_uri')).toBe('https://catalog.example.com/api/shopify/oauth/callback');
    expect(url.searchParams.get('grant_options[]')).toBe('expiring');
    expect(url.searchParams.get('expiring')).toBe('1');
    expect(state).toMatch(/^[a-f0-9]{48}$/);
  });

  it('honours the optional fixed redirect URI', async () => {
    const app = await makeApp();
    const superCookies = await loginSuperAdmin(app);
    await setGlobalCredentials(app, superCookies);
    const { cookies } = await registerComercio(app);
    await configureShop(app, cookies, { shop_domain: 'tienda.myshopify.com' });
    process.env.SHOPIFY_REDIRECT_URI = 'https://fixed.example.com/shopify/callback';

    const { response } = await startOAuth(app, cookies, { Host: 'catalog.example.com' });

    const url = new URL(response.headers.location);
    expect(url.searchParams.get('redirect_uri')).toBe('https://fixed.example.com/shopify/callback');
  });

  it('uses the merchant credentials when the commercio brings its own app', async () => {
    const app = await makeApp();
    const superCookies = await loginSuperAdmin(app);
    await setGlobalCredentials(app, superCookies);
    const { cookies } = await registerComercio(app);
    await configureShop(app, cookies, {
      shop_domain: 'tienda.myshopify.com',
      own_app: true,
      client_id: 'shpca_merchant',
      client_secret: 'shpss_merchant'
    });

    const { response } = await startOAuth(app, cookies);

    const url = new URL(response.headers.location);
    expect(url.searchParams.get('client_id')).toBe('shpca_merchant');
  });

  it('refuses to start without a shop domain or app credentials', async () => {
    const app = await makeApp();
    const { cookies } = await registerComercio(app);

    const withoutShop = await startOAuth(app, cookies);
    expect(withoutShop.response.status).toBe(400);

    await configureShop(app, cookies, { shop_domain: 'tienda.myshopify.com' });
    const withoutCredentials = await startOAuth(app, cookies);
    expect(withoutCredentials.response.status).toBe(400);
  });

  it('denies the OAuth routes to anonymous users', async () => {
    const app = await makeApp();

    expect(await request(app).get('/api/shopify/oauth/start').set('Host', 'catalog.example.com').redirects(0).then((r) => r.status)).toBe(401);
    expect((await request(app).post('/api/shopify/oauth/disconnect')).status).toBe(401);
  });

  it('exchanges the code once, stores the tokens and only exposes the connection status', async () => {
    const app = await makeApp();
    const superCookies = await loginSuperAdmin(app);
    await setGlobalCredentials(app, superCookies);
    const { cookies } = await registerComercio(app);
    await configureShop(app, cookies, { shop_domain: 'tienda.myshopify.com' });
    const { state } = await startOAuth(app, cookies);

    const callback = await request(app).get(`/api/shopify/oauth/callback?state=${state}&code=code123`);
    expect(callback.status).toBe(200);
    expect(callback.text).toContain('Tienda tienda.myshopify.com conectada');
    expect(callback.text).toContain('Volver a Catalog AI');
    expect(post).toHaveBeenCalledWith(
      'https://tienda.myshopify.com/admin/oauth/access_token',
      { client_id: 'shpca_global', client_secret: 'shpss_global_secret', code: 'code123' },
      expect.any(Object)
    );

    const config = await request(app).get('/api/config').set('Cookie', cookies);
    expect(config.body.shopify).toMatchObject({
      shop_domain: 'tienda.myshopify.com',
      own_app: false,
      oauth_connected: true,
      has_api_key: true
    });
    expect(config.body.shopify.access_token).toBe('');
    expect(config.body.shopify.refresh_token).toBe('');
    expect(JSON.stringify(config.body)).not.toContain('token_abc');

    const me = await request(app).get('/api/auth/me').set('Cookie', cookies);
    expect(me.body.user.shopify_configured).toBe(true);

    // The same state cannot be used twice.
    const replay = await request(app).get(`/api/shopify/oauth/callback?state=${state}&code=code123`);
    expect(replay.status).toBe(400);
    expect(replay.text).toContain('Estado de conexión inválido');
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('rejects a callback with an unknown state without contacting Shopify', async () => {
    const app = await makeApp();

    const callback = await request(app).get('/api/shopify/oauth/callback?state=bogus&code=code123');
    expect(callback.status).toBe(400);
    expect(callback.text).toContain('Estado de conexión inválido');
    expect(post).not.toHaveBeenCalled();
  });

  it('refreshes an expiring access token and persists the rotated refresh token', async () => {
    const app = await makeApp();
    const superCookies = await loginSuperAdmin(app);
    await setGlobalCredentials(app, superCookies, { api_version: '2025-10' });
    const { cookies } = await registerComercio(app);
    await configureShop(app, cookies, { shop_domain: 'tienda.myshopify.com' });

    post.mockResolvedValueOnce({
      data: { ...DEFAULT_TOKENS, access_token: 'old_token', refresh_token: 'old_refresh', expires_in: 1 }
    });
    const { state } = await startOAuth(app, cookies);
    await request(app).get(`/api/shopify/oauth/callback?state=${state}&code=code123`);

    post.mockResolvedValueOnce({
      data: { ...DEFAULT_TOKENS, access_token: 'new_token', refresh_token: 'rotated_refresh' }
    });
    const me = await request(app).get('/api/auth/me').set('Cookie', cookies);
    const comercioId = me.body.user.comercio_id as number;
    const persisted = new DatabasePersistence(comercioId).load()!.shopify;
    const runtime = await prepareShopifyRuntimeConfig(persisted);

    expect(post).toHaveBeenCalledWith(
      'https://tienda.myshopify.com/admin/oauth/access_token',
      {
        grant_type: 'refresh_token',
        client_id: 'shpca_global',
        client_secret: 'shpss_global_secret',
        refresh_token: 'old_refresh'
      },
      expect.any(Object)
    );
    expect(runtime.access_token).toBe('new_token');
    expect(runtime.api_version).toBe('2025-10');
    expect(new DatabasePersistence(comercioId).load()!.shopify.refresh_token).toBe('rotated_refresh');
  });

  it('keeps a legacy token without expiry and always applies the global API version', async () => {
    const app = await makeApp();
    const superCookies = await loginSuperAdmin(app);
    await setGlobalCredentials(app, superCookies, { api_version: '2025-10' });

    const runtime = await prepareShopifyRuntimeConfig({
      shop_domain: 'tienda.myshopify.com',
      own_app: false,
      client_id: '',
      client_secret: '',
      access_token: 'legacy_token',
      refresh_token: '',
      scope: '',
      expires_at: '',
      refresh_token_expires_at: ''
    });

    expect(runtime.access_token).toBe('legacy_token');
    expect(runtime.api_version).toBe('2025-10');
    expect(post).not.toHaveBeenCalled();
  });

  it('rejects attempts to set tokens or the API version from a comercio', async () => {
    const app = await makeApp();
    const { cookies } = await registerComercio(app);

    const token = await configureShop(app, cookies, { access_token: 'shpat_forged' });
    expect(token.status).toBe(403);
    const version = await configureShop(app, cookies, { api_version: '2020-01' });
    expect(version.status).toBe(403);
    const scope = await configureShop(app, cookies, { scope: 'write_products' });
    expect(scope.status).toBe(403);
  });

  it('drops the installation when the domain or the app changes', async () => {
    const app = await makeApp();
    const superCookies = await loginSuperAdmin(app);
    await setGlobalCredentials(app, superCookies);
    const { cookies } = await registerComercio(app);
    await configureShop(app, cookies, { shop_domain: 'tienda.myshopify.com' });
    const { state } = await startOAuth(app, cookies);
    await request(app).get(`/api/shopify/oauth/callback?state=${state}&code=code123`);

    const switched = await configureShop(app, cookies, { own_app: true, client_id: 'shpca_merchant' });
    expect(switched.status).toBe(200);
    let config = await request(app).get('/api/config').set('Cookie', cookies);
    expect(config.body.shopify.oauth_connected).toBe(false);

    const { state: secondState } = await startOAuth(app, cookies);
    await request(app).get(`/api/shopify/oauth/callback?state=${secondState}&code=code456`);
    const moved = await configureShop(app, cookies, { shop_domain: 'otra.myshopify.com' });
    expect(moved.status).toBe(200);
    config = await request(app).get('/api/config').set('Cookie', cookies);
    expect(config.body.shopify.oauth_connected).toBe(false);
  });

  it('disconnects the store and clears the connection status', async () => {
    const app = await makeApp();
    const superCookies = await loginSuperAdmin(app);
    await setGlobalCredentials(app, superCookies);
    const { cookies } = await registerComercio(app);
    await configureShop(app, cookies, { shop_domain: 'tienda.myshopify.com' });
    const { state } = await startOAuth(app, cookies);
    await request(app).get(`/api/shopify/oauth/callback?state=${state}&code=code123`);

    const disconnected = await request(app).post('/api/shopify/oauth/disconnect').set('Cookie', cookies);
    expect(disconnected.status).toBe(200);

    const config = await request(app).get('/api/config').set('Cookie', cookies);
    expect(config.body.shopify.oauth_connected).toBe(false);
    const me = await request(app).get('/api/auth/me').set('Cookie', cookies);
    expect(me.body.user.shopify_configured).toBe(false);
  });
});
