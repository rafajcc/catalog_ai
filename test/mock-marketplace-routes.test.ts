// End-to-end tests for the unified /fetch/:marketplace routes. They exercise
// the core dispatch with the canned Mock marketplace, proving the fetch/save/
// dataset flow works for a marketplace that is neither PrestaShop nor Shopify.
import request from 'supertest';
import createApp from '../backend/src/app';
import { DataStore } from '../backend/src/store';

let testStore = new DataStore();

jest.mock('../backend/src/modules/auth/middleware', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { sub: 1, username: 'admin', role: 'admin', comercio_id: 1 };
    next();
  },
  requireRole: () => (_req: any, _res: any, next: any) => next()
}));

jest.mock('../backend/src/modules/auth/load-config-middleware', () => ({
  loadComercioConfig: (req: any, _res: any, next: any) => {
    req.store = testStore;
    req.configPersistence = { save: jest.fn(), load: jest.fn(() => testStore.config) };
    next();
  },
  clearComercioDataStore: () => {
    testStore.clearDatasets();
  }
}));

describe('Mock marketplace over the unified routes', () => {
  beforeEach(() => {
    testStore = new DataStore();
  });

  async function makeApp() {
    return createApp({});
  }

  it('fetches the canned dataset through POST /fetch/mock, capped to 50 products', async () => {
    const app = await makeApp();

    const res = await request(app).post('/api/fetch/mock').send({ references: [], brand: '' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toContain('fetched from Mock');
    expect(res.body.data.products).toHaveLength(50);
    expect(res.body.data.products[0]).toMatchObject({ reference: 'MOCK-001' });
  });

  it('gives every product a unique reference', async () => {
    const app = await makeApp();

    const res = await request(app).post('/api/fetch/mock').send({ references: [], brand: '' });

    const references = res.body.data.products.map((product: any) => product.reference);
    expect(new Set(references).size).toBe(references.length);
  });

  it('filters the canned dataset by brand and by reference', async () => {
    const app = await makeApp();

    const byBrand = await request(app).post('/api/fetch/mock').send({ references: [], brand: 'Aurora' });
    expect(byBrand.status).toBe(200);
    expect(byBrand.body.data.products.length).toBeGreaterThan(0);
    expect(byBrand.body.data.products.every((product: any) => product.brand === 'Aurora')).toBe(true);

    const byReference = await request(app).post('/api/fetch/mock').send({ references: ['MOCK-007'], brand: '' });
    expect(byReference.status).toBe(200);
    expect(byReference.body.data.products).toHaveLength(1);
    expect(byReference.body.data.products[0].reference).toBe('MOCK-007');
  });

  it('returns 404 when the brand or reference matches nothing', async () => {
    const app = await makeApp();

    const res = await request(app).post('/api/fetch/mock').send({ references: [], brand: 'MarcaInexistente' });

    expect(res.status).toBe(404);
    expect(res.body.error.message).toContain('No products matched');
  });

  it('serves the stored dataset via GET /fetch/mock and discards it via DELETE', async () => {
    const app = await makeApp();

    expect((await request(app).get('/api/fetch/mock')).body.data).toBeNull();

    await request(app).post('/api/fetch/mock').send({ references: [], brand: '' }).expect(200);
    const stored = await request(app).get('/api/fetch/mock');
    expect(stored.body.data).toMatchObject({ summary: { total: 50 } });

    const del = await request(app).delete('/api/fetch/mock');
    expect(del.status).toBe(200);
    expect((await request(app).get('/api/fetch/mock')).body.data).toBeNull();
  });

  it('pushes edits back through POST /fetch/mock/save', async () => {
    const app = await makeApp();
    const fetched = await request(app).post('/api/fetch/mock').send({ references: [], brand: '' });
    const productId = fetched.body.data.products[0].id;

    const res = await request(app).post('/api/fetch/mock/save').send({
      updates: { [productId]: { meta_title: 'Editado' } }
    });

    expect(res.status).toBe(200);
    expect(res.body.data.saved).toBe(1);
    expect(res.body.message).toContain('updated in Mock');
  });

  it('rejects an unknown marketplace slug', async () => {
    const app = await makeApp();

    const res = await request(app).post('/api/fetch/woocommerce').send({});

    expect(res.status).toBe(404);
    expect(res.body.error.message).toContain('desconocido');
  });

  it('tests the Mock connection via POST /config/test/mock', async () => {
    const app = await makeApp();

    const res = await request(app).post('/api/config/test/mock').send({});

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Conexión con Mock correcta');
  });
});
