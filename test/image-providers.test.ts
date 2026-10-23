// Tests for the image provider services: the search engine (feeds first,
// round-robin, billing cycles/quota, validation) and the super admin routes
// that manage the providers and the feed table.
//
// Two layers run here:
//  - engine tests call searchProductImages directly against a temp database,
//    with the provider HTTP layer stubbed and the URL validation fetch stubbed,
//  - route tests boot a real app (real auth middleware, super admin login,
//    bcrypt) like auth-superadmin.test.ts does.

import request from 'supertest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import createApp from '../backend/src/app';
import { hashPassword } from '../backend/src/modules/auth/auth';
import { initDatabase } from '../backend/src/modules/auth';
import {
  addProviderFeedImage,
  getImageProviderBySlug,
  listImageProviders,
  updateAutocompleteQuota,
  updateImageProvider,
  upsertImageProvider
} from '../backend/src/modules/auth/database';
import { seedImageProviders } from '../backend/src/modules/image-providers/registry';
import { createRegistrationNonce, generateNonceCode } from '../backend/src/modules/auth/database';
import { searchProductImages } from '../backend/src/modules/image-providers/services/engine';
import { cycleStartForDayOfMonth } from '../backend/src/utils/billing-cycle';

jest.setTimeout(30000);

// The provider services speak to their vendors over HTTP; those calls are
// stubbed to return canned, provider-shaped responses without touching the
// network. Validation (filterImageUrls) uses the stubbed global.fetch below.
// The provider configs carried by the tests are MOCKS too: dummy credentials
// chosen purely to satisfy the "missing API key" guards of each service, with
// no real key, password or token and no external configuration file.
jest.mock('../backend/src/modules/image-providers/utils/http-client', () => ({
  httpGet: jest.fn(),
  httpPost: jest.fn(),
  IMAGE_PROVIDER_USER_AGENT: 'CatalogAI/test',
  DEFAULT_IMAGE_PROVIDER_TIMEOUT_S: 15
}));

const httpClient = require('../backend/src/modules/image-providers/utils/http-client');

const originalFetch = global.fetch;
function imageFetchStub(contentType = 'image/png'): () => Promise<Response> {
  return jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': contentType }),
    body: null
  } as unknown as Response) as unknown as () => Promise<Response>;
}

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
  await initDatabase(makeTempDir('catalogai-imageproviders-'));
  seedImageProviders();
  global.fetch = imageFetchStub();
  (httpClient.httpGet as jest.Mock).mockReset();
  (httpClient.httpPost as jest.Mock).mockReset();
}

function httpStub(routes: Record<string, unknown>) {
  const find = (url: string) => {
    const key = Object.keys(routes).find((candidate) => url.startsWith(candidate));
    return key ? routes[key] : { status: 500, data: null };
  };
  (httpClient.httpGet as jest.Mock).mockImplementation(async (url: string) => find(url));
  (httpClient.httpPost as jest.Mock).mockImplementation(async (url: string) => find(url));
}

// Mock credentials for every service shape used in the tests. The values are
// deliberately fake ("test-key", "test-user", ...) so no real provider secret
// or external configuration file is involved: the HTTP layer is stubbed anyway,
// so only the credential shapes matter (the "Falta la API key" guards must not
// short-circuit the stub-fed scenarios).
function mockConfig(slug: string): Record<string, string> {
  switch (slug) {
    case 'apify':
      return { api_key: 'test-key', actor_id: 's-r/test-actor' };
    case 'barcodelookup':
      return { api_key: 'test-key' };
    case 'brave_images':
      return { api_key: 'test-key' };
    case 'serper':
      return { api_key: 'test-key' };
    case 'serpapi':
      return { api_key: 'test-key' };
    case 'tavily':
      return { api_key: 'test-key' };
    case 'exa':
      return { api_key: 'test-key' };
    case 'scraperapi':
      return { api_key: 'test-key' };
    case 'searchapi':
      return { api_key: 'test-key' };
    case 'zenserp':
      return { api_key: 'test-key' };
    case 'openserp':
      return { api_key: 'test-key' };
    case 'skumonster':
      return { api_key: 'test-key' };
    case 'nexscope':
      return { api_key: 'test-key', marketplace: 'amazon.es' };
    case 'brightdata':
      return { token: 'test-token', zone: '' };
    case 'dataforseo':
      return {
        login: 'test-user',
        password: 'test-password',
        location: 'Spain',
        language: 'Spanish'
      };
    case 'decodo_premium':
      return { username: 'test-user', password: 'test-password' };
    case 'firecrawl':
      return { api_key: 'test-key' };
    case 'oxylabs':
      return { username: 'test-user', password: 'test-password' };
    default:
      return { api_key: 'test-key' };
  }
}

const searchRequest = {
  brand: 'Adidas',
  reference: 'REF-100',
  ean: '840000001234',
  origin: 'http://app.test',
  maxResults: 5
};

beforeAll(async () => {
  adminPasswordHash = await hashPassword(ADMIN_PASSWORD_PLAIN);
  await initDatabase(makeTempDir('catalogai-imageproviders-'));
  seedImageProviders();
});

afterEach(() => {
  (httpClient.httpGet as jest.Mock).mockReset();
  (httpClient.httpPost as jest.Mock).mockReset();
  jest.restoreAllMocks();
  global.fetch = originalFetch;
});

afterAll(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('image search engine', () => {
  beforeEach(async () => {
    await resetDb();
    global.fetch = imageFetchStub();
  });

  it('returns the seeded mock URLs when only the mock provider is enabled', async () => {
    const outcome = await searchProductImages(searchRequest);

    expect(outcome.source).toBe('mock');
    expect(outcome.urls).toHaveLength(5);
    for (const url of outcome.urls) {
      expect(url).toMatch(/^http:\/\/app\.test\/test-product-image(?:-\d+)?\.png$/);
    }
    expect(outcome.attempts.some((attempt) => attempt.slug === 'mock' && attempt.status === 'ok')).toBe(true);
  });

  it('caps the returned URLs at the requested maxResults', async () => {
    const outcome = await searchProductImages({ ...searchRequest, maxResults: 3 });
    expect(outcome.urls).toHaveLength(3);
  });

  it('throws when no provider is enabled at all', async () => {
    updateImageProvider('mock', { enabled: false, config: {} });
    await expect(searchProductImages(searchRequest)).rejects.toThrow(/habilitados e implementados/);
  });

  it('tries the feeds first and tops up the missing slots with the providers', async () => {
    addProviderFeedImage({ brand: 'Adidas', reference: 'REF-100', ean: '840000001234', image_url: 'https://cdn.test/feed-1.png' });
    addProviderFeedImage({ brand: 'Adidas', reference: 'REF-100', ean: '840000001234', image_url: 'https://cdn.test/feed-2.png' });
    updateImageProvider('feeds', { enabled: true });

    const outcome = await searchProductImages(searchRequest);

    // Feeds filled 2 of the 5 slots; the mock provider (the only other enabled
    // one) is asked for the remaining 3 and tops the product up to 5.
    expect(outcome.source).toBe('feeds+mock');
    expect(outcome.urls).toHaveLength(5);
    expect(outcome.urls.slice(0, 2)).toEqual(['https://cdn.test/feed-1.png', 'https://cdn.test/feed-2.png']);
    // Feeds is tried in full before the providers, never advancing the cursor.
    expect(outcome.attempts[0]).toMatchObject({ slug: 'feeds', status: 'ok', urls: 2 });
    const mock = outcome.attempts.find((attempt) => attempt.slug === 'mock');
    expect(mock).toMatchObject({ status: 'ok', urls: 3 });
  });

  it('falls back to a provider when feeds has no row for the product', async () => {
    updateImageProvider('feeds', { enabled: true });

    const outcome = await searchProductImages(searchRequest);

    expect(outcome.source).toBe('mock');
    expect(outcome.attempts.find((attempt) => attempt.slug === 'feeds')).toBeDefined();
  });

  it('accumulates across providers until the product has 5 images, asking each only for the missing slots', async () => {
    updateImageProvider('mock', { enabled: false });
    // Each provider returns fewer images than asked (2, then 1) so the engine
    // must keep walking the chain for the remaining slots.
    httpStub({
      'https://api.apify.com': {
        status: 200,
        data: { items: [{ imageUrl: 'https://cdn.test/a1.png' }, { imageUrl: 'https://cdn.test/a2.png' }] }
      },
      'https://api.barcodelookup.com': {
        status: 200,
        data: { products: [{ images: ['https://cdn.test/b1.png'] }] }
      },
      'https://api.search.brave.com': {
        status: 200,
        data: { results: [{ thumbnail: { src: 'https://cdn.test/c1.png' } }, { thumbnail: { src: 'https://cdn.test/c2.png' } }] }
      }
    });
    updateImageProvider('apify', { enabled: true, config: mockConfig('apify') });
    updateImageProvider('barcodelookup', { enabled: true, config: mockConfig('barcodelookup') });
    updateImageProvider('brave_images', { enabled: true, config: mockConfig('brave_images') });

    const outcome = await searchProductImages(searchRequest);

    // apify gave 2, barcodelookup gave 1, brave gave the last 2: 5 in total.
    expect(outcome.urls).toEqual([
      'https://cdn.test/a1.png',
      'https://cdn.test/a2.png',
      'https://cdn.test/b1.png',
      'https://cdn.test/c1.png',
      'https://cdn.test/c2.png'
    ]);
    expect(outcome.source).toBe('apify+barcodelookup+brave_images');
    // Every provider was asked only for the slots still missing.
    expect(outcome.attempts.find((attempt) => attempt.slug === 'apify')).toMatchObject({ urls: 2 });
    expect(outcome.attempts.find((attempt) => attempt.slug === 'barcodelookup')).toMatchObject({ urls: 1 });
    expect(outcome.attempts.find((attempt) => attempt.slug === 'brave_images')).toMatchObject({ urls: 2 });
  });

  it('does not return duplicate images and asks the next provider for more', async () => {
    updateImageProvider('mock', { enabled: false });
    httpStub({
      'https://api.apify.com': {
        status: 200,
        data: { items: [{ imageUrl: 'https://cdn.test/a.png' }, { imageUrl: 'https://cdn.test/b.png' }] }
      },
      'https://api.barcodelookup.com': {
        status: 200,
        data: { products: [{ images: ['https://cdn.test/b.png', 'https://cdn.test/c.png', 'https://cdn.test/d.png'] }] }
      },
      'https://api.search.brave.com': {
        status: 200,
        data: { results: [{ thumbnail: { src: 'https://cdn.test/e.png' } }] }
      }
    });
    updateImageProvider('apify', { enabled: true, config: mockConfig('apify') });
    updateImageProvider('barcodelookup', { enabled: true, config: mockConfig('barcodelookup') });
    updateImageProvider('brave_images', { enabled: true, config: mockConfig('brave_images') });

    const outcome = await searchProductImages(searchRequest);

    expect(outcome.urls).toEqual([
      'https://cdn.test/a.png',
      'https://cdn.test/b.png',
      'https://cdn.test/c.png',
      'https://cdn.test/d.png',
      'https://cdn.test/e.png'
    ]);
    expect(new Set(outcome.urls).size).toBe(outcome.urls.length);
  });

  it('stops the search when the budget of the exchange is spent and keeps the images already found', async () => {
    updateImageProvider('mock', { enabled: false });
    httpStub({
      'https://api.apify.com': {
        status: 200,
        data: { items: [{ imageUrl: 'https://cdn.test/a.png' }] }
      },
      'https://api.barcodelookup.com': {
        status: 200,
        data: { products: [{ images: ['https://cdn.test/b.png'] }] }
      }
    });
    updateImageProvider('apify', { enabled: true, config: mockConfig('apify') });
    updateImageProvider('barcodelookup', { enabled: true, config: mockConfig('barcodelookup') });

    // The budget is already spent when the search starts: no provider is called.
    const outcome = await searchProductImages({ ...searchRequest, deadline: Date.now() - 1 });

    expect(outcome.urls).toEqual([]);
    expect(outcome.attempts).toEqual([]);
  });

  it('cuts a provider that hangs at the remaining budget and returns without images', async () => {
    updateImageProvider('mock', { enabled: false });
    updateImageProvider('apify', { enabled: true, config: mockConfig('apify') });
    updateImageProvider('barcodelookup', { enabled: true, config: mockConfig('barcodelookup') });

    // The provider never answers, so only the budget of the exchange can end
    // the call (its own HTTP timeout goes up to 300s).
    const hanging = () => new Promise(() => {});
    (httpClient.httpGet as jest.Mock).mockImplementation(hanging);
    (httpClient.httpPost as jest.Mock).mockImplementation(hanging);

    const startedAt = Date.now();
    const outcome = await searchProductImages({ ...searchRequest, deadline: Date.now() + 50 });
    const elapsed = Date.now() - startedAt;

    expect(elapsed).toBeLessThan(2000);
    expect(outcome.urls).toEqual([]);
    const cut = outcome.attempts.find((attempt) => attempt.status === 'error');
    expect(cut?.error).toContain('presupuesto');
    expect(outcome.attempts.some((attempt) => attempt.status === 'ok')).toBe(false);
  });

  it('stops asking providers once the product already has 5 images', async () => {
    updateImageProvider('mock', { enabled: false });
    httpStub({
      'https://api.apify.com': {
        status: 200,
        data: {
          items: [
            { imageUrl: 'https://cdn.test/a1.png' },
            { imageUrl: 'https://cdn.test/a2.png' },
            { imageUrl: 'https://cdn.test/a3.png' },
            { imageUrl: 'https://cdn.test/a4.png' },
            { imageUrl: 'https://cdn.test/a5.png' }
          ]
        }
      },
      'https://api.barcodelookup.com': {
        status: 200,
        data: { products: [{ images: ['https://cdn.test/b1.png'] }] }
      }
    });
    updateImageProvider('apify', { enabled: true, config: mockConfig('apify') });
    updateImageProvider('barcodelookup', { enabled: true, config: mockConfig('barcodelookup') });

    const outcome = await searchProductImages(searchRequest);

    // apify alone filled the 5 slots, so barcodelookup was never called.
    expect(outcome.urls).toHaveLength(5);
    expect(outcome.source).toBe('apify');
    expect(outcome.attempts.find((attempt) => attempt.slug === 'barcodelookup')).toBeUndefined();
    // The unused provider was not billed either.
    expect(getImageProviderBySlug('barcodelookup')?.calls_this_cycle).toBe(0);
  });

  it('walks the enabled providers in sort_order, advancing a global cursor', async () => {
    updateImageProvider('mock', { enabled: false });
    // Each provider returns enough images to fill the product on its own, so
    // one call per search is made and the cursor advances exactly one step.
    httpStub({
      'https://api.apify.com': {
        status: 200,
        data: { items: Array.from({ length: 5 }, (_, i) => ({ imageUrl: `https://cdn.test/a${i}.png` })) }
      },
      'https://api.barcodelookup.com': {
        status: 200,
        data: { products: [{ images: Array.from({ length: 5 }, (_, i) => `https://cdn.test/b${i}.png`) }] }
      },
      'https://api.search.brave.com': {
        status: 200,
        data: { results: Array.from({ length: 5 }, (_, i) => ({ thumbnail: { src: `https://cdn.test/c${i}.png` } })) }
      }
    });
    updateImageProvider('apify', { enabled: true, config: mockConfig('apify') });
    updateImageProvider('barcodelookup', { enabled: true, config: mockConfig('barcodelookup') });
    updateImageProvider('brave_images', { enabled: true, config: mockConfig('brave_images') });

    const first = await searchProductImages(searchRequest);
    expect(first.source).toBe('apify');
    expect((await searchProductImages(searchRequest)).source).toBe('barcodelookup');
    expect((await searchProductImages(searchRequest)).source).toBe('brave_images');
    // Fourth call wraps around to the first provider again.
    expect((await searchProductImages(searchRequest)).source).toBe('apify');
  });

  it('skips a provider over its monthly quota without consuming the call budget', async () => {
    updateImageProvider('mock', { enabled: false });
    updateImageProvider('apify', { enabled: true, config: { ...mockConfig('apify'), max_calls_per_month: '1' } });
    updateImageProvider('apify', { calls_this_cycle: 1 });
    httpStub({
      'https://api.apify.com': { status: 200, data: { items: [{ imageUrl: 'https://cdn.test/a1.png' }] } },
      'https://api.barcodelookup.com': {
        status: 200,
        data: { products: [{ images: ['https://cdn.test/b1.png'] }] }
      }
    });
    updateImageProvider('barcodelookup', { enabled: true, config: mockConfig('barcodelookup') });

    const outcome = await searchProductImages(searchRequest);

    expect(outcome.source).toBe('barcodelookup');
    const quota = outcome.attempts.find((attempt) => attempt.slug === 'apify');
    expect(quota?.status).toBe('quota');
    // The skipped call did not consume the 5-call budget nor the monthly quota.
    expect(getImageProviderBySlug('apify')?.calls_this_cycle).toBe(1);
  });

  it('resets the billing counters when the billing cycle day rolls over', async () => {
    updateImageProvider('mock', { enabled: false });
    updateImageProvider('apify', { enabled: true, config: mockConfig('apify') });
    updateImageProvider('apify', { billing_cycle_day: 15, cycle_start: '2000-01-01', calls_this_cycle: 5 });
    httpStub({ 'https://api.apify.com': { status: 200, data: { items: [{ imageUrl: 'https://cdn.test/a1.png' }] } } });

    const outcome = await searchProductImages(searchRequest);
    expect(outcome.source).toBe('apify');

    const row = getImageProviderBySlug('apify');
    expect(row?.cycle_start).toBe(cycleStartForDayOfMonth(15));
    expect(row?.calls_this_cycle).toBe(1);
  });

  it('returns an empty outcome (not a crash) when every provider comes back empty', async () => {
    updateImageProvider('mock', { enabled: false });
    updateImageProvider('apify', { enabled: true, config: { api_key: 'k1' } });
    httpStub({ 'https://api.apify.com': { status: 200, data: { items: [] } } });

    const outcome = await searchProductImages(searchRequest);
    expect(outcome.urls).toEqual([]);
    expect(outcome.source).toBeNull();
    // Apify legitimately throws when it has no results, which the engine records
    // as an error attempt and keeps going.
    expect(outcome.attempts.find((attempt) => attempt.slug === 'apify')?.status).toBe('error');
  });

  it('does not call an EAN-only Apify actor when the request has no EAN', async () => {
    updateImageProvider('mock', { enabled: false });
    updateImageProvider('apify', {
      enabled: true,
      config: { ...mockConfig('apify'), actor_id: 's-r/ean-product-image-search---extract-images-from-any-ean-gtin' }
    });
    httpStub({ 'https://api.apify.com': { status: 200, data: { items: [{ imageUrl: 'https://cdn.test/a1.png' }] } } });

    const outcome = await searchProductImages({ ...searchRequest, ean: '' });
    expect(httpClient.httpPost).not.toHaveBeenCalled();
    expect(outcome.urls).toEqual([]);
    const attempt = outcome.attempts.find((entry) => entry.slug === 'apify');
    expect(attempt?.status).toBe('error');
    expect(attempt?.error).toMatch(/no trae EAN/);
  });
});

describe('image providers super admin API', () => {
  function extractCookies(res: request.Response): string[] {
    const cookies = (res.headers['set-cookie'] as unknown as string[]) ?? [];
    return cookies.map((c) => c.split(';')[0]);
  }

  async function makeApp() {
    const app = await createApp({ dataDir: makeTempDir('catalogai-imgprov-api-') });
    return app;
  }

  async function setSuperAdminEnv(enabled: boolean) {
    if (enabled) {
      process.env.ADMIN_USER = ADMIN_USERNAME;
      process.env.ADMIN_PASSWORD = adminPasswordHash;
    } else {
      delete process.env.ADMIN_USER;
      delete process.env.ADMIN_PASSWORD;
    }
  }

  async function loginAsSuperAdmin(app: Awaited<ReturnType<typeof createApp>>) {
    const res = await request(app).post('/api/auth/login').send({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD_PLAIN });
    return extractCookies(res);
  }

  it('lists the seeded providers with enabled mock and the two non-implemented crawlers', async () => {
    setSuperAdminEnv(true);
    const app = await makeApp();
    const cookies = await loginAsSuperAdmin(app);

    const res = await request(app).get('/api/superadmin/image-providers').set('Cookie', cookies);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(23);

    const mock = res.body.data.find((provider: any) => provider.slug === 'mock');
    expect(mock.enabled).toBe(true);
    expect(mock.implemented).toBe(true);

    const scraperJs = res.body.data.find((provider: any) => provider.slug === 'scraper_js');
    expect(scraperJs.implemented).toBe(false);
    expect(scraperJs.enabled).toBe(false);
    for (const provider of res.body.data) {
      expect(provider.config).toBeUndefined();
      expect(provider.has_api_key).toBeDefined();
      expect(provider).toHaveProperty('api_key_hint');
      expect(provider).toHaveProperty('username_hint');
      expect(provider).toHaveProperty('password_hint');
      for (const field of provider.extra_config) {
        expect(field).toHaveProperty('value');
      }
    }
  });

  it('prunes unregistered slugs and refreshes names on reseed', async () => {
    // Simulate a database that predates the Decodo unification: a stale
    // decodo_standard row plus an old, verbose name on decodo_premium.
    upsertImageProvider({ slug: 'decodo_standard', name: 'Decodo (Proxy Standard)', sort_order: 99, enabled: false });
    updateImageProvider('decodo_premium', { name: 'Decodo (Proxy Premium)' });

    seedImageProviders();

    const rows = listImageProviders();
    expect(rows.some((row) => row.slug === 'decodo_standard')).toBe(false);
    expect(rows.find((row) => row.slug === 'decodo_premium')?.name).toBe('Decodo');
  });

  it('updates a provider config without ever exposing the stored secret', async () => {
    setSuperAdminEnv(true);
    const app = await makeApp();
    const cookies = await loginAsSuperAdmin(app);

    const update = await request(app)
      .put('/api/superadmin/image-providers/brave_images')
      .set('Cookie', cookies)
      .send({ enabled: true, config: { api_key: 'top-secret' } });
    expect(update.status).toBe(200);
    expect(update.body.data.has_api_key).toBe(true);
    expect(update.body.data.api_key_hint).toBe('top••••••••ret');
    expect(JSON.stringify(update.body.data)).not.toContain('top-secret');

    const fetched = await request(app).get('/api/superadmin/image-providers').set('Cookie', cookies);
    const brave = fetched.body.data.find((provider: any) => provider.slug === 'brave_images');
    expect(brave.enabled).toBe(true);
    expect(brave.has_api_key).toBe(true);
    expect(brave.api_key_hint).toBe('top••••••••ret');
  });

  it('exposes masked username and password hints for user/password providers', async () => {
    setSuperAdminEnv(true);
    const app = await makeApp();
    const cookies = await loginAsSuperAdmin(app);

    await request(app)
      .put('/api/superadmin/image-providers/dataforseo')
      .set('Cookie', cookies)
      .send({ config: { username: 'api-user@example.com', password: 'super-secret-pass' } });

    const fetched = await request(app).get('/api/superadmin/image-providers').set('Cookie', cookies);
    const dataforseo = fetched.body.data.find((provider: any) => provider.slug === 'dataforseo');
    expect(dataforseo.has_username).toBe(true);
    expect(dataforseo.has_password).toBe(true);
    expect(dataforseo.username_hint).toBe('api••••••••com');
    expect(dataforseo.password_hint).toBe('sup••••••••ass');
    expect(JSON.stringify(dataforseo)).not.toContain('api-user@example.com');
    expect(JSON.stringify(dataforseo)).not.toContain('super-secret-pass');
  });

  it('exposes the value of the non-secret extra config fields', async () => {
    setSuperAdminEnv(true);
    const app = await makeApp();
    const cookies = await loginAsSuperAdmin(app);

    await request(app)
      .put('/api/superadmin/image-providers/apify')
      .set('Cookie', cookies)
      .send({ config: { actor_id: 'automation-lab/google-images-scraper' } });

    const fetched = await request(app).get('/api/superadmin/image-providers').set('Cookie', cookies);
    const apify = fetched.body.data.find((provider: any) => provider.slug === 'apify');
    const actorField = apify.extra_config.find((field: any) => field.key === 'actor_id');
    expect(actorField.configured).toBe(true);
    expect(actorField.value).toBe('automation-lab/google-images-scraper');
  });

  it('keeps the stored key on an empty string and deletes it on null', async () => {
    setSuperAdminEnv(true);
    const app = await makeApp();
    const cookies = await loginAsSuperAdmin(app);

    await request(app)
      .put('/api/superadmin/image-providers/serper')
      .set('Cookie', cookies)
      .send({ config: { api_key: 'abc' } });

    await request(app)
      .put('/api/superadmin/image-providers/serper')
      .set('Cookie', cookies)
      .send({ config: { api_key: '' } });
    let fetched = await request(app).get('/api/superadmin/image-providers').set('Cookie', cookies);
    expect(fetched.body.data.find((p: any) => p.slug === 'serper').has_api_key).toBe(true);
    expect(fetched.body.data.find((p: any) => p.slug === 'serper').api_key_hint).toBe('••••••••');

    await request(app)
      .put('/api/superadmin/image-providers/serper')
      .set('Cookie', cookies)
      .send({ config: { api_key: null } });
    fetched = await request(app).get('/api/superadmin/image-providers').set('Cookie', cookies);
    expect(fetched.body.data.find((p: any) => p.slug === 'serper').has_api_key).toBe(false);
  });

  it('refuses to enable a non-implemented provider', async () => {
    setSuperAdminEnv(true);
    const app = await makeApp();
    const cookies = await loginAsSuperAdmin(app);

    const res = await request(app)
      .put('/api/superadmin/image-providers/scraper_js')
      .set('Cookie', cookies)
      .send({ enabled: true });
    expect(res.status).toBe(400);
  });

  it('reorders the providers and resets the billing counters', async () => {
    setSuperAdminEnv(true);
    const app = await makeApp();
    const cookies = await loginAsSuperAdmin(app);

    updateImageProvider('mock', { calls_this_cycle: 42, billing_cycle_day: 15 });
    const reset = await request(app).post('/api/superadmin/image-providers/mock/reset-calls').set('Cookie', cookies);
    expect(reset.status).toBe(200);
    expect(getImageProviderBySlug('mock')?.calls_this_cycle).toBe(0);

    const list = await request(app).get('/api/superadmin/image-providers').set('Cookie', cookies);
    const reversed = list.body.data.map((provider: any) => provider.slug).reverse();
    const reorder = await request(app)
      .put('/api/superadmin/image-providers/reorder')
      .set('Cookie', cookies)
      .send({ ordered_slugs: reversed });
    expect(reorder.status).toBe(200);

    const after = await request(app).get('/api/superadmin/image-providers').set('Cookie', cookies);
    expect(after.body.data.map((provider: any) => provider.slug)).toEqual(reversed);
  });

  it('rejects a reorder that does not list every provider', async () => {
    setSuperAdminEnv(true);
    const app = await makeApp();
    const cookies = await loginAsSuperAdmin(app);

    const res = await request(app)
      .put('/api/superadmin/image-providers/reorder')
      .set('Cookie', cookies)
      .send({ ordered_slugs: ['mock'] });
    expect(res.status).toBe(400);
  });

  it('manages provider feed images', async () => {
    setSuperAdminEnv(true);
    const app = await makeApp();
    const cookies = await loginAsSuperAdmin(app);

    const created = await request(app)
      .post('/api/superadmin/image-providers/feeds')
      .set('Cookie', cookies)
      .send({ brand: 'Nike', reference: 'REF-X', ean: '8400', image_url: 'https://cdn.test/nike.png' });
    expect(created.status).toBe(200);
    expect(created.body.data.reference).toBe('REF-X');

    const listed = await request(app).get('/api/superadmin/image-providers/feeds').set('Cookie', cookies);
    expect(listed.body.data).toHaveLength(1);

    const deleted = await request(app)
      .delete(`/api/superadmin/image-providers/feeds/${created.body.data.id}`)
      .set('Cookie', cookies);
    expect(deleted.status).toBe(200);
    const empty = await request(app).get('/api/superadmin/image-providers/feeds').set('Cookie', cookies);
    expect(empty.body.data).toHaveLength(0);
  });

  it('rejects invalid feed entries', async () => {
    setSuperAdminEnv(true);
    const app = await makeApp();
    const cookies = await loginAsSuperAdmin(app);

    const noUrl = await request(app)
      .post('/api/superadmin/image-providers/feeds')
      .set('Cookie', cookies)
      .send({ brand: 'Nike', image_url: 'not-a-url' });
    expect(noUrl.status).toBe(400);
  });

  it('denies the provider routes to a regular admin', async () => {
    setSuperAdminEnv(false);
    const app = await makeApp();
    const nonce = createRegistrationNonce(
      generateNonceCode(),
      new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
      'test-root'
    );
    await request(app).post('/api/auth/register-comercio').send({
      comercio_name: 'Tienda B',
      admin_username: 'admin',
      admin_password: 'Str0ng!Password',
      nonce: nonce.code
    });
    const login = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'Str0ng!Password' });
    const cookies = extractCookies(login);

    const res = await request(app).get('/api/superadmin/image-providers').set('Cookie', cookies);
    expect(res.status).toBe(403);
  });

  it('serves mock images through the full autocomplete flow with the real auth', async () => {
    setSuperAdminEnv(false);
    const app = await makeApp();
    const registration = await request(app)
      .post('/api/auth/register-comercio')
      .send({
        comercio_name: 'Tienda C',
        admin_username: 'admin',
        admin_password: 'Str0ng!Password',
        nonce: createRegistrationNonce(
          generateNonceCode(),
          new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
          'test-root'
        ).code
      });
    const login = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'Str0ng!Password' });
    const cookies = extractCookies(login);

    // Autocomplete is disabled until the super admin grants a quota to the
    // comercio; this test is about the image flow, so it enables it outright.
    const comercioId = registration.body?.comercio?.id ?? 1;
    updateAutocompleteQuota(comercioId, { monthly_limit: -1, billing_cycle_day: 1 });

    global.fetch = imageFetchStub();
    const res = await request(app).post('/api/autocomplete').set('Cookie', cookies).send({
      language: 'es',
      product: {
        id: 'p1',
        status: 'pending',
        source_file: 'PrestaShop',
        validation_errors: [],
        warnings: [],
        reference: 'REF-100',
        name: 'Camiseta Deportiva',
        brand: 'Adidas',
        description: '',
        description_short: '',
        meta_title: '',
        meta_description: ''
      }
    });

    expect(res.status).toBe(200);
    expect(res.body.data.image_source).toBe('mock');
    expect(res.body.data.image_urls).toHaveLength(5);
  });
});