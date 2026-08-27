import request from 'supertest';
import createApp from '../backend/src/app';

describe('createApp', () => {
  afterEach(() => {
    delete process.env.RATE_LIMIT_MAX;
  });

  it('returns an Express app', async () => {
    const app = await createApp();

    expect(app).toBeDefined();
    expect(typeof app.get).toBe('function');
    expect(typeof app.use).toBe('function');
  });

  it('responds with Online status at /api/status', async () => {
    const app = await createApp();

    const res = await request(app).get('/api/status');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, message: 'Online', version: expect.any(String) });
  });

  it('responds with a 404 JSON error for unknown API routes', async () => {
    const app = await createApp();

    const res = await request(app).get('/api/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      success: false,
      error: { message: 'Route not found: GET /api/does-not-exist', statusCode: 404 }
    });
  });

  it('serves the frontend SPA fallback for non-API routes when a build exists', async () => {
    const fs = require('fs');
    const path = require('path');
    const publicIndex = path.join(__dirname, '..', 'backend', 'public', 'index.html');

    const app = await createApp();
    const res = await request(app).get('/some/client/route');

    if (fs.existsSync(publicIndex)) {
      // Build artifacts present: SPA fallback serves index.html
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
    } else {
      // No build: unknown non-API route 404s
      expect(res.status).toBe(404);
    }
  });

  it('handles malformed JSON bodies with a 400 error', async () => {
    const app = await createApp();

    const res = await request(app)
      .post('/api/parse-test')
      .set('Content-Type', 'application/json')
      .send('{invalid json');

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.statusCode).toBe(400);
  });

  it('applies helmet security headers', async () => {
    const app = await createApp();

    const res = await request(app).get('/api/does-not-exist');

    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBeDefined();
  });

  it('sends the configured CORS origin header', async () => {
    const app = await createApp();

    const res = await request(app).get('/api/does-not-exist').set('Origin', 'http://example.com');

    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });

  it('returns 429 after exceeding the configured rate limit', async () => {
    process.env.RATE_LIMIT_MAX = '2';
    const app = await createApp();

    await request(app).get('/api/a');
    await request(app).get('/api/b');
    const res = await request(app).get('/api/c');

    expect(res.status).toBe(429);
    expect(res.text).toContain('Too many requests from this IP');
  });

  it('reads the CORS origin from the FRONTEND_URL environment variable', async () => {
    process.env.FRONTEND_URL = 'http://frontend.test';
    const app = await createApp();

    const res = await request(app).get('/does-not-exist').set('Origin', 'http://frontend.test');

    expect(res.headers['access-control-allow-origin']).toBe('http://frontend.test');
    delete process.env.FRONTEND_URL;
  });
});
