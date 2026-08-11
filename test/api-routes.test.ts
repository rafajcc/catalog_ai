import request from 'supertest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import createApp from '../backend/src/app';
import { PrestaShopClient } from '../backend/src/modules/prestashop-client/prestashop-client';

describe('API routes', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'catalogai-test-'));
  });

  afterAll(async () => {
    await fs.remove(tempDir);
  });

  function makeApp(options: { fakePrestashop?: boolean; prestashopClient?: PrestaShopClient; configFile?: string } = {}) {
    const opts: any = {};
    if (options.fakePrestashop) {
      const fakeClient =
        options.prestashopClient ?? ({ testConnection: () => Promise.resolve(true) } as unknown as PrestaShopClient);
      opts.prestashopClientFactory = () => fakeClient;
    }
    if (options.configFile) {
      opts.configFile = options.configFile;
    }
    return createApp(opts);
  }

  function makeFakeClient(): PrestaShopClient {
    return {
      testConnection: () => Promise.resolve(true),
      fetchCombinationsByEan: jest.fn().mockResolvedValue([]),
      fetchProductsById: jest.fn().mockResolvedValue([]),
      fetchStockByIds: jest.fn().mockResolvedValue([]),
      fetchStockByProductIds: jest.fn().mockResolvedValue([]),
      fetchProductsByReference: jest.fn().mockResolvedValue([]),
      fetchCombinationsByIds: jest.fn().mockResolvedValue([]),
      fetchAllProducts: jest.fn().mockResolvedValue([]),
      fetchManufacturers: jest.fn().mockResolvedValue([]),
      fetchCategories: jest.fn().mockResolvedValue([])
    } as unknown as PrestaShopClient;
  }

  async function configurePrestashop(app: ReturnType<typeof createApp>): Promise<void> {
    const saved = await request(app)
      .put('/api/config')
      .send({ prestashop: { base_url: 'https://shop.example.com', api_key: 'secret', language_id: 1 } });
    expect(saved.status).toBe(200);
  }

  it('exposes the default configuration', async () => {
    const res = await request(makeApp()).get('/api/config');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.prestashop).toBeDefined();
    expect(res.body.prestashop.version).toBe('1.7');
    expect(res.body.ai).toBeDefined();
  });

  it('merges partial configuration updates', async () => {
    const app = makeApp();

    const update = await request(app)
      .put('/api/config')
      .send({ prestashop: { base_url: 'https://shop.example.com', api_key: 'secret' } });

    expect(update.status).toBe(200);
    expect(update.body.success).toBe(true);

    const res = await request(app).get('/api/config');
    expect(res.body.prestashop.base_url).toBe('https://shop.example.com');
    expect(res.body.prestashop.api_key).toBe('secret');
    expect(res.body.prestashop.version).toBe('1.7');
  });

  it('tests the AI connection with the mock provider', async () => {
    const res = await request(makeApp()).post('/api/config/test/ai').send({
      provider: 'mock',
      enabled_fields: ['name', 'description']
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('rejects the PrestaShop connection test without credentials', async () => {
    const res = await request(makeApp())
      .post('/api/config/test/prestashop')
      .send({ base_url: '', api_key: '' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('tests the PrestaShop connection with an injected client', async () => {
    const res = await request(makeApp({ fakePrestashop: true }))
      .post('/api/config/test/prestashop')
      .send({ base_url: 'https://shop.example.com', api_key: 'secret' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('rejects fetching from PrestaShop when it is not configured', async () => {
    const app = makeApp();

    const res = await request(app).post('/api/fetch/prestashop').send({ eans: ['8412345678901'] });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.message).toContain('configured');
  });

  it('returns no PrestaShop data before anything has been fetched', async () => {
    const res = await request(makeApp()).get('/api/fetch/prestashop');

    expect(res.status).toBe(200);
    expect(res.body.data).toBeNull();
  });

  it('fetches the first products when no EAN or reference is given, applying the filters', async () => {
    const fakeClient = makeFakeClient();
    (fakeClient.fetchAllProducts as jest.Mock).mockResolvedValue([
      { id: '5', name: 'Con desc', description: 'Larga', image_count: 2, combination_ids: ['11'], categories: [] },
      { id: '6', name: 'Sin desc', image_count: 0, combination_ids: ['12'], categories: [] }
    ]);
    (fakeClient.fetchCombinationsByIds as jest.Mock).mockResolvedValue([
      { id_product_attribute: '11', id_product: '5', reference: 'REF-A', stock_available_id: '50' },
      { id_product_attribute: '12', id_product: '6', reference: 'REF-B', stock_available_id: '51' }
    ]);
    (fakeClient.fetchProductsById as jest.Mock).mockResolvedValue([
      { id: '5', name: 'Con desc', description: 'Larga', image_count: 2, categories: [] },
      { id: '6', name: 'Sin desc', image_count: 0, categories: [] }
    ]);
    const app = makeApp({ fakePrestashop: true, prestashopClient: fakeClient });
    await configurePrestashop(app);

    const res = await request(app)
      .post('/api/fetch/prestashop')
      .send({ eans: [], references: [], description: 'with', images: 'with' });

    expect(res.status).toBe(200);
    expect(res.body.data.products).toHaveLength(1);
    expect(res.body.data.products[0].reference).toBe('REF-A');
    expect(fakeClient.fetchAllProducts).toHaveBeenCalled();
    expect(fakeClient.fetchCombinationsByEan).not.toHaveBeenCalled();
    expect(fakeClient.fetchProductsByReference).not.toHaveBeenCalled();
  });

  it('combines the description and images filters with OR when requested', async () => {
    const fakeClient = makeFakeClient();
    (fakeClient.fetchAllProducts as jest.Mock).mockResolvedValue([
      { id: '5', name: 'Sin img', description: 'Larga', image_count: 0, combination_ids: ['11'], categories: [] },
      { id: '6', name: 'Sin desc', image_count: 2, combination_ids: ['12'], categories: [] },
      { id: '7', name: 'Completo', description: 'Larga', image_count: 2, combination_ids: ['13'], categories: [] }
    ]);
    (fakeClient.fetchCombinationsByIds as jest.Mock).mockResolvedValue([
      { id_product_attribute: '11', id_product: '5', stock_available_id: '50' },
      { id_product_attribute: '12', id_product: '6', stock_available_id: '51' },
      { id_product_attribute: '13', id_product: '7', stock_available_id: '52' }
    ]);
    (fakeClient.fetchProductsById as jest.Mock).mockResolvedValue([
      { id: '5', name: 'Sin img', description: 'Larga', image_count: 0, categories: [] },
      { id: '6', name: 'Sin desc', image_count: 2, categories: [] },
      { id: '7', name: 'Completo', description: 'Larga', image_count: 2, categories: [] }
    ]);
    const app = makeApp({ fakePrestashop: true, prestashopClient: fakeClient });
    await configurePrestashop(app);

    const res = await request(app)
      .post('/api/fetch/prestashop')
      .send({ eans: [], references: [], description: 'without', images: 'without', filter_operator: 'or' });

    expect(res.status).toBe(200);
    expect(res.body.data.products).toHaveLength(2);
    const names = res.body.data.products.map((product: { name: string }) => product.name).sort();
    expect(names).toEqual(['Sin desc', 'Sin img']);
  });

  it('imports products without combinations as product-level rows when no criteria are given', async () => {
    const fakeClient = makeFakeClient();
    (fakeClient.fetchAllProducts as jest.Mock).mockResolvedValue([
      { id: '5', name: 'Simple', reference: 'REF-S', price: 9.99, image_count: 1, categories: ['8'] },
      { id: '6', name: 'Con combos', image_count: 1, combination_ids: ['11'], categories: [] }
    ]);
    (fakeClient.fetchCombinationsByIds as jest.Mock).mockResolvedValue([
      { id_product_attribute: '11', id_product: '6', reference: 'REF-C', stock_available_id: '50' }
    ]);
    (fakeClient.fetchProductsById as jest.Mock).mockResolvedValue([
      { id: '5', name: 'Simple', reference: 'REF-S', price: 9.99, image_count: 1, categories: ['8'] },
      { id: '6', name: 'Con combos', image_count: 1, categories: [] }
    ]);
    (fakeClient.fetchStockByProductIds as jest.Mock).mockResolvedValue([{ id_product: '5', quantity: 4 }]);
    (fakeClient.fetchStockByIds as jest.Mock).mockResolvedValue([{ id: '50', quantity: 7 }]);
    (fakeClient.fetchManufacturers as jest.Mock).mockResolvedValue([]);
    (fakeClient.fetchCategories as jest.Mock).mockResolvedValue([{ id: '8', name: 'Categoria Uno' }]);
    const app = makeApp({ fakePrestashop: true, prestashopClient: fakeClient });
    await configurePrestashop(app);

    const res = await request(app).post('/api/fetch/prestashop').send({ eans: [], references: [] });

    expect(res.status).toBe(200);
    expect(res.body.data.products).toHaveLength(2);
    expect(res.body.data.products[0]).toMatchObject({
      id: 'ps_11',
      source_file: 'prestashop',
      reference: 'REF-C',
      quantity: 7
    });
    expect(res.body.data.products[1]).toMatchObject({
      id: 'ps_p5',
      source_file: 'prestashop',
      reference: 'REF-S',
      price: 9.99,
      quantity: 4,
      category: 'Categoria Uno'
    });
    expect(fakeClient.fetchStockByProductIds).toHaveBeenCalledWith(['5']);
  });

  it('returns 404 when the no-criteria fetch finds nothing to import', async () => {
    const fakeClient = makeFakeClient();
    (fakeClient.fetchAllProducts as jest.Mock).mockResolvedValue([
      { id: '5', name: 'Filtrado', image_count: 0, categories: [] }
    ]);
    const app = makeApp({ fakePrestashop: true, prestashopClient: fakeClient });
    await configurePrestashop(app);

    const res = await request(app)
      .post('/api/fetch/prestashop')
      .send({ eans: [], references: [], images: 'with' });

    expect(res.status).toBe(404);
    expect(res.body.error.message).toContain('No products matched');
  });

  it('fetches products from PrestaShop by EAN and stores the dataset', async () => {
    const fakeClient = makeFakeClient();
    (fakeClient.fetchCombinationsByEan as jest.Mock).mockResolvedValue([
      {
        id_product_attribute: '11',
        id_product: '5',
        ean13: '8412345678901',
        reference: 'REF-A',
        price: 19.99,
        wholesale_price: 15,
        stock_available_id: '50'
      }
    ]);
    (fakeClient.fetchProductsById as jest.Mock).mockResolvedValue([
      { id: '5', name: 'Producto', description: 'Desc', description_short: 'Corta', tax_rules_group_id: 5, manufacturer_id: '3', categories: ['8'], image_count: 1 }
    ]);
    (fakeClient.fetchManufacturers as jest.Mock).mockResolvedValue([{ id: '3', name: 'Marca Uno' }]);
    (fakeClient.fetchCategories as jest.Mock).mockResolvedValue([{ id: '8', name: 'Categoria Uno' }]);
    (fakeClient.fetchStockByIds as jest.Mock).mockResolvedValue([{ id: '50', quantity: 7 }]);
    const app = makeApp({ fakePrestashop: true, prestashopClient: fakeClient });
    await configurePrestashop(app);

    const res = await request(app)
      .post('/api/fetch/prestashop')
      .send({ eans: ['8412345678901'], description: 'all', images: 'all' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.data_id).toBeDefined();
    expect(res.body.data.products).toHaveLength(1);
    expect(res.body.data.products[0]).toMatchObject({
      id: 'ps_11',
      source_file: 'prestashop',
      ean: '8412345678901',
      reference: 'REF-A',
      name: 'Producto',
      description: 'Desc',
      description_short: 'Corta',
      brand: 'Marca Uno',
      category: 'Categoria Uno',
      tax: '5',
      price: 19.99,
      wholesale_price: 15,
      quantity: 7
    });

    const stored = await request(app).get('/api/fetch/prestashop');
    expect(stored.status).toBe(200);
    expect(stored.body.data.summary.total).toBe(1);
  });

  it('applies the description and images filters to the fetched rows', async () => {
    const fakeClient = makeFakeClient();
    (fakeClient.fetchCombinationsByEan as jest.Mock).mockResolvedValue([
      { id_product_attribute: '11', id_product: '5', ean13: '8412345678901', stock_available_id: '50' },
      { id_product_attribute: '12', id_product: '6', ean13: '8412345678902', stock_available_id: '51' }
    ]);
    (fakeClient.fetchProductsById as jest.Mock).mockResolvedValue([
      { id: '5', name: 'Con desc', description: 'Larga', image_count: 2, categories: [] },
      { id: '6', name: 'Sin desc', image_count: 0, categories: [] }
    ]);
    const app = makeApp({ fakePrestashop: true, prestashopClient: fakeClient });
    await configurePrestashop(app);

    const res = await request(app)
      .post('/api/fetch/prestashop')
      .send({ eans: ['8412345678901'], description: 'with', images: 'with' });

    expect(res.status).toBe(200);
    expect(res.body.data.products).toHaveLength(1);
    expect(res.body.data.products[0].ean).toBe('8412345678901');
  });

  it('limits the fetched rows to 50', async () => {
    const fakeClient = makeFakeClient();
    const combos = Array.from({ length: 60 }, (_, index) => ({
      id_product_attribute: `c${index + 1}`,
      id_product: `p${index + 1}`,
      ean13: `84${String(index + 1).padStart(11, '0')}`,
      stock_available_id: `s${index + 1}`
    }));
    (fakeClient.fetchCombinationsByEan as jest.Mock).mockResolvedValue(combos);
    (fakeClient.fetchProductsById as jest.Mock).mockResolvedValue(
      combos.map((combo) => ({ id: combo.id_product, name: `P${combo.id_product}`, categories: [] }))
    );
    const app = makeApp({ fakePrestashop: true, prestashopClient: fakeClient });
    await configurePrestashop(app);

    const res = await request(app).post('/api/fetch/prestashop').send({ eans: ['8412345678901'] });

    expect(res.status).toBe(200);
    expect(res.body.data.products).toHaveLength(50);
  });

  it('fetches products by reference through their combinations', async () => {
    const fakeClient = makeFakeClient();
    (fakeClient.fetchProductsByReference as jest.Mock).mockResolvedValue([
      { id: '7', reference: 'REF-Z', name: 'Por ref', combination_ids: ['21'], categories: [] }
    ]);
    (fakeClient.fetchCombinationsByIds as jest.Mock).mockResolvedValue([
      { id_product_attribute: '21', id_product: '7', reference: 'REF-Z', ean13: '8412345678909', stock_available_id: '60' }
    ]);
    (fakeClient.fetchProductsById as jest.Mock).mockResolvedValue([
      { id: '7', reference: 'REF-Z', name: 'Por ref', combination_ids: ['21'], categories: [] }
    ]);
    (fakeClient.fetchStockByIds as jest.Mock).mockResolvedValue([{ id: '60', quantity: 3 }]);
    const app = makeApp({ fakePrestashop: true, prestashopClient: fakeClient });
    await configurePrestashop(app);

    const res = await request(app).post('/api/fetch/prestashop').send({ references: ['REF-Z'] });

    expect(res.status).toBe(200);
    expect(fakeClient.fetchProductsByReference).toHaveBeenCalledWith(['REF-Z']);
    expect(fakeClient.fetchCombinationsByIds).toHaveBeenCalledWith(['21']);
    expect(res.body.data.products).toHaveLength(1);
    expect(res.body.data.products[0].ean).toBe('8412345678909');
    expect(res.body.data.products[0].quantity).toBe(3);
  });

  it('returns 404 when no products match the fetch criteria', async () => {
    const fakeClient = makeFakeClient();
    (fakeClient.fetchCombinationsByEan as jest.Mock).mockResolvedValue([]);
    (fakeClient.fetchProductsByReference as jest.Mock).mockResolvedValue([]);
    const app = makeApp({ fakePrestashop: true, prestashopClient: fakeClient });
    await configurePrestashop(app);

    const res = await request(app).post('/api/fetch/prestashop').send({ eans: ['999'] });

    expect(res.status).toBe(404);
    expect(res.body.error.message).toContain('No products matched');
  });

  it('discards the PrestaShop-fetched data via DELETE', async () => {
    const fakeClient = makeFakeClient();
    (fakeClient.fetchCombinationsByEan as jest.Mock).mockResolvedValue([
      { id_product_attribute: '11', id_product: '5', ean13: '8412345678901', stock_available_id: '50' }
    ]);
    const app = makeApp({ fakePrestashop: true, prestashopClient: fakeClient });
    await configurePrestashop(app);

    const fetched = await request(app).post('/api/fetch/prestashop').send({ eans: ['8412345678901'] });
    expect(fetched.status).toBe(200);

    const del = await request(app).delete('/api/fetch/prestashop');
    expect(del.status).toBe(200);

    const after = await request(app).get('/api/fetch/prestashop');
    expect(after.body.data).toBeNull();
  });

  it('persists the configuration across app instances with encrypted secrets', async () => {
    const configFile = path.join(tempDir, 'config.json');
    const first = makeApp({ configFile });

    const saved = await request(first)
      .put('/api/config')
      .send({ prestashop: { base_url: 'https://shop.example.com', api_key: 'persisted-secret', version: '8' } });
    expect(saved.status).toBe(200);
    expect(saved.body.prestashop.base_url).toBe('https://shop.example.com');

    const raw = fs.readFileSync(configFile, 'utf8');
    expect(raw).not.toContain('persisted-secret');

    const second = makeApp({ configFile });
    const loaded = await request(second).get('/api/config');
    expect(loaded.status).toBe(200);
    expect(loaded.body.prestashop.base_url).toBe('https://shop.example.com');
    expect(loaded.body.prestashop.api_key).toBe('persisted-secret');
    expect(loaded.body.prestashop.version).toBe('8');
  });

  it('serves health and logs endpoints', async () => {
    const app = makeApp();

    const health = await request(app).get('/api/health');
    expect(health.status).toBe(200);
    expect(health.body.status).toBe('ok');

    const logs = await request(app).get('/api/logs');
    expect(logs.status).toBe(200);
    expect(Array.isArray(logs.body.data)).toBe(true);
  });
});
