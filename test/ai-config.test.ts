// Tests for the global AI provider configuration exposed to the super admin.
// The AI setup was moved from a per-comercio config to a single global one, so
// these tests boot a real app with real auth (super admin login) and a temp
// database, like the image-providers super admin suite.

import request from 'supertest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import createApp from '../backend/src/app';
import { hashPassword } from '../backend/src/modules/auth/auth';
import { initDatabase } from '../backend/src/modules/auth';

jest.mock('axios', () => ({
  post: jest.fn(),
  get: jest.fn()
}));

const mockAxios = require('axios');

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

beforeAll(async () => {
  adminPasswordHash = await hashPassword(ADMIN_PASSWORD_PLAIN);
  await initDatabase(makeTempDir('catalogai-aiconfig-'));
});

afterEach(() => {
  (mockAxios.post as jest.Mock).mockReset();
});

afterAll(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('AI providers super admin API', () => {
  function extractCookies(res: request.Response): string[] {
    const cookies = (res.headers['set-cookie'] as unknown as string[]) ?? [];
    return cookies.map((c) => c.split(';')[0]);
  }

  async function makeApp() {
    return createApp({ dataDir: makeTempDir('catalogai-aiconfig-api-') });
  }

  async function loginAsSuperAdmin(app: Awaited<ReturnType<typeof createApp>>) {
    process.env.ADMIN_USER = ADMIN_USERNAME;
    process.env.ADMIN_PASSWORD = adminPasswordHash;
    const res = await request(app).post('/api/auth/login').send({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD_PLAIN });
    return extractCookies(res);
  }

  it('lists every provider with masked keys and flags the active one', async () => {
    const app = await makeApp();
    const cookies = await loginAsSuperAdmin(app);

    const res = await request(app).get('/api/superadmin/ai-providers').set('Cookie', cookies);
    expect(res.status).toBe(200);
    expect(res.body.data.map((p: any) => p.name).sort()).toEqual(['anthropic', 'mock', 'openai', 'openrouter']);

    const mock = res.body.data.find((p: any) => p.name === 'mock');
    expect(mock.is_active).toBe(true);
    expect(mock.enabled).toBe(true);
    for (const provider of res.body.data) {
      expect(provider.api_key).toBeUndefined();
      expect(typeof provider.has_api_key).toBe('boolean');
    }
  });

  it('updates a provider and never exposes the stored key', async () => {
    const app = await makeApp();
    const cookies = await loginAsSuperAdmin(app);

    const update = await request(app)
      .put('/api/superadmin/ai-providers/openai')
      .set('Cookie', cookies)
      .send({ model: 'gpt-4o', api_key: 'top-secret', timeout: 60, concurrency: 8, web_search: false });
    expect(update.status).toBe(200);
    expect(update.body.data.model).toBe('gpt-4o');
    expect(update.body.data.timeout).toBe(60);
    expect(update.body.data.concurrency).toBe(8);
    expect(update.body.data.has_api_key).toBe(true);
    expect(JSON.stringify(update.body.data)).not.toContain('top-secret');

    const fetched = await request(app).get('/api/superadmin/ai-providers').set('Cookie', cookies);
    const openai = fetched.body.data.find((p: any) => p.name === 'openai');
    expect(openai.has_api_key).toBe(true);
  });

  it('keeps the stored key on an empty string and deletes it on null', async () => {
    const app = await makeApp();
    const cookies = await loginAsSuperAdmin(app);

    await request(app)
      .put('/api/superadmin/ai-providers/anthropic')
      .set('Cookie', cookies)
      .send({ api_key: 'sk-abc' });

    await request(app)
      .put('/api/superadmin/ai-providers/anthropic')
      .set('Cookie', cookies)
      .send({ api_key: '' });
    let fetched = await request(app).get('/api/superadmin/ai-providers').set('Cookie', cookies);
    expect(fetched.body.data.find((p: any) => p.name === 'anthropic').has_api_key).toBe(true);

    await request(app)
      .put('/api/superadmin/ai-providers/anthropic')
      .set('Cookie', cookies)
      .send({ api_key: null });
    fetched = await request(app).get('/api/superadmin/ai-providers').set('Cookie', cookies);
    expect(fetched.body.data.find((p: any) => p.name === 'anthropic').has_api_key).toBe(false);
  });

  it('clears the timeout and the concurrency when they are emptied', async () => {
    const app = await makeApp();
    const cookies = await loginAsSuperAdmin(app);

    await request(app)
      .put('/api/superadmin/ai-providers/openai')
      .set('Cookie', cookies)
      .send({ timeout: 60, concurrency: 8 });

    const cleared = await request(app)
      .put('/api/superadmin/ai-providers/openai')
      .set('Cookie', cookies)
      .send({ timeout: '', concurrency: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.timeout).toBeNull();
    expect(cleared.body.data.concurrency).toBeNull();
  });

  it('clears an invalid concurrency so the frontend default applies', async () => {
    const app = await makeApp();
    const cookies = await loginAsSuperAdmin(app);

    const res = await request(app)
      .put('/api/superadmin/ai-providers/openai')
      .set('Cookie', cookies)
      .send({ concurrency: 0 });

    expect(res.status).toBe(200);
    expect(res.body.data.concurrency).toBeNull();
  });

  it('switches the active provider and reports whether it is usable', async () => {
    const app = await makeApp();
    const cookies = await loginAsSuperAdmin(app);

    await request(app)
      .put('/api/superadmin/ai-providers/openai')
      .set('Cookie', cookies)
      .send({ api_key: 'sk-live' });

    const active = await request(app)
      .put('/api/superadmin/ai-providers/active')
      .set('Cookie', cookies)
      .send({ provider: 'openai' });
    expect(active.status).toBe(200);
    expect(active.body.data.provider).toBe('openai');
    expect(active.body.data.usable).toBe(true);

    const listed = await request(app).get('/api/superadmin/ai-providers').set('Cookie', cookies);
    expect(listed.body.data.find((p: any) => p.name === 'openai').is_active).toBe(true);
  });

  it('rejects an unknown provider as active', async () => {
    const app = await makeApp();
    const cookies = await loginAsSuperAdmin(app);

    const res = await request(app)
      .put('/api/superadmin/ai-providers/active')
      .set('Cookie', cookies)
      .send({ provider: 'nope' });
    expect(res.status).toBe(400);
  });

  it('returns 404 when updating an unknown provider', async () => {
    const app = await makeApp();
    const cookies = await loginAsSuperAdmin(app);

    const res = await request(app)
      .put('/api/superadmin/ai-providers/nope')
      .set('Cookie', cookies)
      .send({ model: 'x' });
    expect(res.status).toBe(404);
  });

  it('tests the connection with the mock provider without any HTTP call', async () => {
    const app = await makeApp();
    const cookies = await loginAsSuperAdmin(app);

    const res = await request(app)
      .post('/api/superadmin/ai-providers/test')
      .set('Cookie', cookies)
      .send({ provider: 'mock' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('fails the connection test when the cloud provider rejects the key', async () => {
    const app = await makeApp();
    const cookies = await loginAsSuperAdmin(app);

    (mockAxios.post as jest.Mock).mockRejectedValue(
      Object.assign(new Error('Request failed with status code 401'), {
        response: { status: 401, data: { error: { message: 'Incorrect API key provided' } } }
      })
    );

    const res = await request(app)
      .post('/api/superadmin/ai-providers/test')
      .set('Cookie', cookies)
      .send({ provider: 'openai', model: 'gpt-4o-mini', api_key: 'invalid' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('denies the AI provider routes to a regular admin', async () => {
    const app = await makeApp();
    delete process.env.ADMIN_USER;
    delete process.env.ADMIN_PASSWORD;

    const { createRegistrationNonce, generateNonceCode } = require('../backend/src/modules/auth/database');
    const nonce = createRegistrationNonce(generateNonceCode(), new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(), 'test-root');
    await request(app).post('/api/auth/register-comercio').send({
      comercio_name: 'Tienda IA',
      admin_username: 'admin',
      admin_password: 'Str0ng!Password',
      nonce: nonce.code
    });
    const login = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'Str0ng!Password' });
    const cookies = extractCookies(login);

    const res = await request(app).get('/api/superadmin/ai-providers').set('Cookie', cookies);
    expect(res.status).toBe(403);
  });
});
