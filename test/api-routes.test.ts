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
      fetchStockByProductIds: jest.fn().mockResolvedValue([]),
      fetchProductsByReference: jest.fn().mockResolvedValue([]),
      fetchProductsByManufacturer: jest.fn().mockResolvedValue([]),
      fetchAllProducts: jest.fn().mockResolvedValue([]),
      fetchManufacturers: jest.fn().mockResolvedValue([]),
      fetchCategories: jest.fn().mockResolvedValue([]),
      fetchProductImage: jest.fn().mockRejectedValue(new Error('no image'))
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

    const res = await request(app).post('/api/fetch/prestashop').send({ brand: 'Sony' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.message).toContain('configured');
  });

  it('returns no PrestaShop data before anything has been fetched', async () => {
    const res = await request(makeApp()).get('/api/fetch/prestashop');

    expect(res.status).toBe(200);
    expect(res.body.data).toBeNull();
  });

  it('fetches the first products when no reference or brand is given, applying the filters', async () => {
    const fakeClient = makeFakeClient();
    (fakeClient.fetchAllProducts as jest.Mock).mockResolvedValue([
      { id: '5', name: 'Con desc', reference: 'REF-A', description: 'Larga', image_count: 2, categories: [] },
      { id: '6', name: 'Sin desc', image_count: 0, categories: [] }
    ]);
    const app = makeApp({ fakePrestashop: true, prestashopClient: fakeClient });
    await configurePrestashop(app);

    const res = await request(app)
      .post('/api/fetch/prestashop')
      .send({ references: [], brand: '', description: 'with', images: 'with' });

    expect(res.status).toBe(200);
    expect(res.body.data.products).toHaveLength(1);
    expect(res.body.data.products[0].reference).toBe('REF-A');
    expect(fakeClient.fetchAllProducts).toHaveBeenCalled();
    expect(fakeClient.fetchProductsByManufacturer).not.toHaveBeenCalled();
    expect(fakeClient.fetchProductsByReference).not.toHaveBeenCalled();
  });

  it('combines the description and images filters with OR when requested', async () => {
    const fakeClient = makeFakeClient();
    (fakeClient.fetchAllProducts as jest.Mock).mockResolvedValue([
      { id: '5', name: 'Sin img', description: 'Larga', image_count: 0, categories: [] },
      { id: '6', name: 'Sin desc', image_count: 2, categories: [] },
      { id: '7', name: 'Completo', description: 'Larga', image_count: 2, categories: [] }
    ]);
    const app = makeApp({ fakePrestashop: true, prestashopClient: fakeClient });
    await configurePrestashop(app);

    const res = await request(app)
      .post('/api/fetch/prestashop')
      .send({ references: [], brand: '', description: 'without', images: 'without', filter_operator: 'or' });

    expect(res.status).toBe(200);
    expect(res.body.data.products).toHaveLength(2);
    const names = res.body.data.products.map((product: { name: string }) => product.name).sort();
    expect(names).toEqual(['Sin desc', 'Sin img']);
  });

  it('imports every product as a single product-level row when no criteria are given', async () => {
    const fakeClient = makeFakeClient();
    (fakeClient.fetchAllProducts as jest.Mock).mockResolvedValue([
      { id: '5', name: 'Simple', reference: 'REF-S', price: 9.99, image_count: 1, categories: ['8'] },
      { id: '6', name: 'Con combos', reference: 'REF-C', price: 12.5, image_count: 1, categories: [] }
    ]);
    (fakeClient.fetchStockByProductIds as jest.Mock).mockResolvedValue([
      { id_product: '5', quantity: 4 },
      { id_product: '6', quantity: 7 }
    ]);
    (fakeClient.fetchManufacturers as jest.Mock).mockResolvedValue([]);
    (fakeClient.fetchCategories as jest.Mock).mockResolvedValue([{ id: '8', name: 'Categoria Uno' }]);
    const app = makeApp({ fakePrestashop: true, prestashopClient: fakeClient });
    await configurePrestashop(app);

    const res = await request(app).post('/api/fetch/prestashop').send({ references: [], brand: '' });

    expect(res.status).toBe(200);
    expect(res.body.data.products).toHaveLength(2);
    expect(res.body.data.products[0]).toMatchObject({
      id: 'ps_p5',
      source_file: 'prestashop',
      reference: 'REF-S',
      price: 9.99,
      quantity: 4,
      category: 'Categoria Uno'
    });
    expect(res.body.data.products[1]).toMatchObject({
      id: 'ps_p6',
      source_file: 'prestashop',
      reference: 'REF-C',
      price: 12.5,
      quantity: 7
    });
    expect(fakeClient.fetchStockByProductIds).toHaveBeenCalledWith(['5', '6']);
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
      .send({ references: [], brand: '', images: 'with' });

    expect(res.status).toBe(404);
    expect(res.body.error.message).toContain('No products matched');
  });

  it('fetches products from PrestaShop by brand and stores the dataset', async () => {
    const fakeClient = makeFakeClient();
    (fakeClient.fetchManufacturers as jest.Mock).mockResolvedValue([{ id: '3', name: 'Marca Uno' }]);
    (fakeClient.fetchProductsByManufacturer as jest.Mock).mockResolvedValue([
      {
        id: '5',
        name: 'Producto',
        reference: 'REF-A',
        ean13: '8412345678901',
        description: 'Desc',
        description_short: 'Corta',
        tax_rules_group_id: 5,
        manufacturer_id: '3',
        categories: ['8'],
        image_count: 1,
        price: 19.99,
        wholesale_price: 15
      }
    ]);
    (fakeClient.fetchStockByProductIds as jest.Mock).mockResolvedValue([{ id_product: '5', quantity: 7 }]);
    (fakeClient.fetchCategories as jest.Mock).mockResolvedValue([{ id: '8', name: 'Categoria Uno' }]);
    const app = makeApp({ fakePrestashop: true, prestashopClient: fakeClient });
    await configurePrestashop(app);

    const res = await request(app)
      .post('/api/fetch/prestashop')
      .send({ brand: 'Marca Uno', description: 'all', images: 'all' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(fakeClient.fetchProductsByManufacturer).toHaveBeenCalledWith(['3']);
    expect(res.body.data.data_id).toBeDefined();
    expect(res.body.data.products).toHaveLength(1);
    expect(res.body.data.products[0]).toMatchObject({
      id: 'ps_p5',
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
    (fakeClient.fetchManufacturers as jest.Mock).mockResolvedValue([{ id: '3', name: 'Marca Uno' }]);
    (fakeClient.fetchProductsByManufacturer as jest.Mock).mockResolvedValue([
      { id: '5', manufacturer_id: '3', description: 'Larga', ean13: '8412345678901', image_count: 2, categories: [] },
      { id: '6', manufacturer_id: '3', image_count: 0, categories: [] }
    ]);
    const app = makeApp({ fakePrestashop: true, prestashopClient: fakeClient });
    await configurePrestashop(app);

    const res = await request(app)
      .post('/api/fetch/prestashop')
      .send({ brand: 'Marca Uno', description: 'with', images: 'with' });

    expect(res.status).toBe(200);
    expect(res.body.data.products).toHaveLength(1);
    expect(res.body.data.products[0].ean).toBe('8412345678901');
  });

  it('limits the fetched rows to 50', async () => {
    const fakeClient = makeFakeClient();
    const products = Array.from({ length: 60 }, (_, index) => ({
      id: `p${index + 1}`,
      manufacturer_id: '1',
      name: `P${index + 1}`,
      categories: []
    }));
    (fakeClient.fetchManufacturers as jest.Mock).mockResolvedValue([{ id: '1', name: 'Marca' }]);
    (fakeClient.fetchProductsByManufacturer as jest.Mock).mockResolvedValue(products);
    const app = makeApp({ fakePrestashop: true, prestashopClient: fakeClient });
    await configurePrestashop(app);

    const res = await request(app).post('/api/fetch/prestashop').send({ brand: 'Marca' });

    expect(res.status).toBe(200);
    expect(res.body.data.products).toHaveLength(50);
  });

  it('fetches products by reference', async () => {
    const fakeClient = makeFakeClient();
    (fakeClient.fetchProductsByReference as jest.Mock).mockResolvedValue([
      { id: '7', reference: 'REF-Z', name: 'Por ref', ean13: '8412345678909', categories: [] }
    ]);
    (fakeClient.fetchStockByProductIds as jest.Mock).mockResolvedValue([{ id_product: '7', quantity: 3 }]);
    const app = makeApp({ fakePrestashop: true, prestashopClient: fakeClient });
    await configurePrestashop(app);

    const res = await request(app).post('/api/fetch/prestashop').send({ references: ['REF-Z'] });

    expect(res.status).toBe(200);
    expect(fakeClient.fetchProductsByReference).toHaveBeenCalledWith(['REF-Z']);
    expect(res.body.data.products).toHaveLength(1);
    expect(res.body.data.products[0].id).toBe('ps_p7');
    expect(res.body.data.products[0].ean).toBe('8412345678909');
    expect(res.body.data.products[0].quantity).toBe(3);
  });

  it('returns 404 when no products match the fetch criteria', async () => {
    const fakeClient = makeFakeClient();
    (fakeClient.fetchManufacturers as jest.Mock).mockResolvedValue([{ id: '3', name: 'Marca Uno' }]);
    (fakeClient.fetchProductsByManufacturer as jest.Mock).mockResolvedValue([]);
    (fakeClient.fetchProductsByReference as jest.Mock).mockResolvedValue([]);
    const app = makeApp({ fakePrestashop: true, prestashopClient: fakeClient });
    await configurePrestashop(app);

    const res = await request(app).post('/api/fetch/prestashop').send({ brand: 'Marca Uno' });

    expect(res.status).toBe(404);
    expect(fakeClient.fetchProductsByManufacturer).toHaveBeenCalledWith(['3']);
    expect(res.body.error.message).toContain('No products matched');
  });

  it('filters reference matches by brand through the manufacturer id', async () => {
    const fakeClient = makeFakeClient();
    (fakeClient.fetchManufacturers as jest.Mock).mockResolvedValue([{ id: '3', name: 'Marca Uno' }]);
    (fakeClient.fetchProductsByReference as jest.Mock).mockResolvedValue([
      { id: '5', reference: 'REF-A', manufacturer_id: '3', name: 'De Marca', categories: [] },
      { id: '6', reference: 'REF-B', manufacturer_id: '4', name: 'Otra Marca', categories: [] }
    ]);
    const app = makeApp({ fakePrestashop: true, prestashopClient: fakeClient });
    await configurePrestashop(app);

    const res = await request(app)
      .post('/api/fetch/prestashop')
      .send({ references: ['REF-A', 'REF-B'], brand: 'Marca Uno' });

    expect(res.status).toBe(200);
    expect(res.body.data.products).toHaveLength(1);
    expect(res.body.data.products[0].reference).toBe('REF-A');
  });

  it('includes meta fields and image references in the imported rows', async () => {
    const fakeClient = makeFakeClient();
    (fakeClient.fetchProductsByReference as jest.Mock).mockResolvedValue([
      {
        id: '7',
        reference: 'REF-M',
        name: 'Con meta',
        description: 'Larga',
        description_short: 'Corta',
        meta_title: 'Titulo SEO',
        meta_description: 'Descripcion SEO',
        image_ids: ['30', '31', '32', '33', '34', '35'],
        categories: []
      }
    ]);
    const app = makeApp({ fakePrestashop: true, prestashopClient: fakeClient });
    await configurePrestashop(app);

    const res = await request(app).post('/api/fetch/prestashop').send({ references: ['REF-M'] });

    expect(res.status).toBe(200);
    expect(res.body.data.products).toHaveLength(1);
    expect(res.body.data.products[0]).toMatchObject({
      name: 'Con meta',
      reference: 'REF-M',
      description: 'Larga',
      description_short: 'Corta',
      meta_title: 'Titulo SEO',
      meta_description: 'Descripcion SEO'
    });
    expect(res.body.data.products[0].images).toHaveLength(5);
    expect(res.body.data.products[0].images[0]).toMatchObject({
      id: '30',
      product_id: '7',
      url: '/api/fetch/prestashop/images/7/30'
    });
    expect(res.body.data.products[0].images[4].id).toBe('34');
  });

  it('proxies a PrestaShop product image with the right content type', async () => {
    const fakeClient = makeFakeClient();
    (fakeClient.fetchProductImage as jest.Mock).mockResolvedValue(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d])
    );
    const app = makeApp({ fakePrestashop: true, prestashopClient: fakeClient });
    await configurePrestashop(app);

    const res = await request(app).get('/api/fetch/prestashop/images/7/30');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(fakeClient.fetchProductImage).toHaveBeenCalledWith('7', '30');
  });

  it('rejects the image proxy without a configured shop', async () => {
    const res = await request(makeApp()).get('/api/fetch/prestashop/images/7/30');

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('discards the PrestaShop-fetched data via DELETE', async () => {
    const fakeClient = makeFakeClient();
    (fakeClient.fetchManufacturers as jest.Mock).mockResolvedValue([{ id: '3', name: 'Marca Uno' }]);
    (fakeClient.fetchProductsByManufacturer as jest.Mock).mockResolvedValue([
      { id: '5', name: 'Producto', manufacturer_id: '3', categories: [] }
    ]);
    const app = makeApp({ fakePrestashop: true, prestashopClient: fakeClient });
    await configurePrestashop(app);

    const fetched = await request(app).post('/api/fetch/prestashop').send({ brand: 'Marca Uno' });
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
