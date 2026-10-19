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
});