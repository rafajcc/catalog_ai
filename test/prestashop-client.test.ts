import axios from 'axios';
import { PrestaShopClient } from '../backend/src/modules/prestashop-client/prestashop-client';
import { logger } from '../backend/src/utils/logger';
import type { PrestaShopConfig } from '../backend/src/types';

jest.mock('axios', () => ({
  __esModule: true,
  default: { create: jest.fn() }
}));

const mockAxiosCreate = axios.create as jest.Mock;

const baseConfig: PrestaShopConfig = {
  base_url: 'https://shop.example.com',
  api_key: 'SECRET-KEY',
  version: '1.7',
  language_id: 1
};

interface FakeClient {
  get: jest.Mock;
  put: jest.Mock;
  patch: jest.Mock;
  post: jest.Mock;
  requestInterceptor?: (config: any) => any;
  requestErrorHandler?: (error: any) => Promise<any>;
  responseInterceptor?: (response: any) => any;
  responseErrorHandler?: (error: any) => Promise<any>;
}

function makeFakeClient(): FakeClient {
  const fake: FakeClient = {
    get: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
    post: jest.fn()
  };
  (fake as any).interceptors = {
    request: {
      use: jest.fn((ok: any, err?: any) => {
        fake.requestInterceptor = ok;
        fake.requestErrorHandler = err;
      })
    },
    response: {
      use: jest.fn((ok: any, err?: any) => {
        fake.responseInterceptor = ok;
        fake.responseErrorHandler = err;
      })
    }
  };
  return fake;
}

function makeClient(fake: FakeClient, config: PrestaShopConfig = baseConfig): PrestaShopClient {
  mockAxiosCreate.mockReturnValue(fake as never);
  return new PrestaShopClient(config);
}

describe('PrestaShopClient', () => {
  beforeEach(() => {
    jest.spyOn(logger, 'error').mockImplementation(() => {});
    jest.spyOn(logger, 'warn').mockImplementation(() => {});
    jest.spyOn(logger, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('constructor', () => {
    it('creates an axios instance with the base URL and default timeout', () => {
      const fake = makeFakeClient();

      makeClient(fake);

      expect(mockAxiosCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: 'https://shop.example.com',
          timeout: 30000,
          headers: expect.objectContaining({
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/xml'
          })
        })
      );
    });

    it('honors a custom timeout', () => {
      const fake = makeFakeClient();

      makeClient(fake, { ...baseConfig, timeout: 5000 });

      expect(mockAxiosCreate).toHaveBeenCalledWith(expect.objectContaining({ timeout: 5000 }));
    });

    it('strips a trailing "/api" from the base URL', () => {
      const fake = makeFakeClient();

      makeClient(fake, { ...baseConfig, base_url: 'https://shop.example.com/api/' });

      expect(mockAxiosCreate).toHaveBeenCalledWith(expect.objectContaining({ baseURL: 'https://shop.example.com' }));
    });
  });

  describe('request interceptor', () => {
    it('adds the Basic auth header with the API key as the username', () => {
      const fake = makeFakeClient();
      makeClient(fake);

      const config = { headers: {} };
      const result = fake.requestInterceptor!(config);

      const expected = Buffer.from('SECRET-KEY:').toString('base64');
      expect(result.headers.Authorization).toBe(`Basic ${expected}`);
    });

    it('rejects request errors', async () => {
      const fake = makeFakeClient();
      makeClient(fake);

      const error = new Error('boom');
      await expect(fake.requestErrorHandler!(error)).rejects.toBe(error);
    });
  });

  describe('response interceptor', () => {
    it('passes successful responses through', () => {
      const fake = makeFakeClient();
      makeClient(fake);

      const response = { data: '<prestashop/>' };
      expect(fake.responseInterceptor!(response)).toEqual(response);
    });

    it('throws a clear error on 401 responses', async () => {
      const fake = makeFakeClient();
      makeClient(fake);

      const error = { response: { status: 401 }, message: 'Unauthorized', config: { url: '/api/products' } };
      await expect(fake.responseErrorHandler!(error)).rejects.toThrow(
        'Invalid PrestaShop API key or insufficient permissions'
      );
    });

    it('warns and rethrows on 404 responses', async () => {
      const fake = makeFakeClient();
      makeClient(fake);

      const error = { response: { status: 404 }, message: 'Not Found', config: { url: '/api/products', method: 'get' } };
      await expect(fake.responseErrorHandler!(error)).rejects.toBe(error);
      expect(logger.warn).toHaveBeenCalledWith('PrestaShop resource not found', {
        url: '/api/products',
        method: 'get'
      });
    });

    it('logs and rethrows on 5xx responses', async () => {
      const fake = makeFakeClient();
      makeClient(fake);

      const error = { response: { status: 500 }, message: 'Internal', config: { url: '/api/products', method: 'post' } };
      await expect(fake.responseErrorHandler!(error)).rejects.toBe(error);
      expect(logger.error).toHaveBeenCalledWith('PrestaShop server error', {
        status: 500,
        url: '/api/products',
        error: 'Internal'
      });
    });

    it('rethrows network errors without response data unchanged', async () => {
      const fake = makeFakeClient();
      makeClient(fake);

      const error = new Error('ECONNRESET');
      await expect(fake.responseErrorHandler!(error)).rejects.toBe(error);
    });
  });

  describe('testConnection', () => {
    it('returns true when the API responds with 200', async () => {
      const fake = makeFakeClient();
      fake.get.mockResolvedValue({ status: 200 });
      const client = makeClient(fake);

      const result = await client.testConnection();

      expect(fake.get).toHaveBeenCalledWith('/api');
      expect(result).toBe(true);
    });

    it('returns false when the API is unreachable', async () => {
      const fake = makeFakeClient();
      fake.get.mockRejectedValue(new Error('ECONNREFUSED'));
      const client = makeClient(fake);

      const result = await client.testConnection();

      expect(result).toBe(false);
    });
  });

  describe('fetchProductImage', () => {
    it('fetches the raw image bytes for a product image', async () => {
      const fake = makeFakeClient();
      const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
      fake.get.mockResolvedValue({ data: bytes });
      const client = makeClient(fake);

      const result = await client.fetchProductImage('9', '30');

      expect(fake.get).toHaveBeenCalledWith('/api/images/products/9/30', { responseType: 'arraybuffer' });
      expect(result).toEqual(bytes);
    });
  });

  describe('fetchProductsByManufacturer', () => {
    it('fetches products of the given manufacturers with an OR filter', async () => {
      const fake = makeFakeClient();
      fake.get.mockResolvedValue({
        data: `<prestashop>
          <products>
            <product>
              <id><![CDATA[5]]></id>
              <id_manufacturer xlink:href="https://shop.example.com/api/manufacturers/3"><![CDATA[3]]></id_manufacturer>
              <reference><![CDATA[REF-A]]></reference>
              <name><language id="1" xlink:href="https://shop.example.com/api/languages/1"><![CDATA[Producto]]></language></name>
            </product>
          </products>
        </prestashop>`
      });
      const client = makeClient(fake);

      const result = await client.fetchProductsByManufacturer(['3', '4']);

      expect(fake.get).toHaveBeenCalledWith('/api/products', {
        params: { 'filter[id_manufacturer]': '[3|4]', display: 'full', limit: 1000 }
      });
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: '5',
        reference: 'REF-A',
        name: 'Producto',
        manufacturer_id: '3'
      });
    });

    it('chunks large batches of manufacturer ids', async () => {
      const fake = makeFakeClient();
      fake.get.mockResolvedValue({ data: '<prestashop><products/></prestashop>' });
      const client = makeClient(fake);

      const ids = Array.from({ length: 101 }, (_, i) => String(i + 1));

      await client.fetchProductsByManufacturer(ids);

      expect(fake.get).toHaveBeenCalledTimes(2);
      const firstFilter = fake.get.mock.calls[0][1].params['filter[id_manufacturer]'];
      const secondFilter = fake.get.mock.calls[1][1].params['filter[id_manufacturer]'];
      expect(firstFilter).toContain('|');
      expect(secondFilter).not.toContain('|');
    });
  });

  describe('fetchProductsById', () => {
    it('fetches full product data for the given ids', async () => {
      const fake = makeFakeClient();
      fake.get.mockResolvedValue({
        data: `<prestashop>
          <products>
            <product>
              <id><![CDATA[9]]></id>
              <reference><![CDATA[REF-1]]></reference>
              <name><language id="1"><![CDATA[Camiseta]]></language></name>
              <tax_rules_group_id><![CDATA[21]]></tax_rules_group_id>
              <id_manufacturer xlink:href="https://shop.example.com/api/manufacturers/4"><![CDATA[4]]></id_manufacturer>
              <associations>
                <categories>
                  <category xlink:href="https://shop.example.com/api/categories/8"><id><![CDATA[8]]></id></category>
                  <category xlink:href="https://shop.example.com/api/categories/9"><id><![CDATA[9]]></id></category>
                </categories>
              </associations>
            </product>
          </products>
        </prestashop>`
      });
      const client = makeClient(fake);

      const result = await client.fetchProductsById(['9']);

      expect(fake.get).toHaveBeenCalledWith('/api/products', {
        params: { 'filter[id]': '[9]', display: 'full', limit: 1000 }
      });
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: '9',
        reference: 'REF-1',
        name: 'Camiseta',
        tax_rules_group_id: 21,
        manufacturer_id: '4',
        categories: ['8', '9']
      });
    });
  });

  describe('extractProductInfo', () => {
    it('extracts localized meta fields and image associations', async () => {
      const fake = makeFakeClient();
      fake.get.mockResolvedValue({
        data: `<prestashop>
          <products>
            <product>
              <id><![CDATA[9]]></id>
              <reference><![CDATA[REF-1]]></reference>
              <name><language id="1"><![CDATA[Camiseta]]></language></name>
              <description><language id="1"><![CDATA[Larga]]></language></description>
              <description_short><language id="1"><![CDATA[Corta]]></language></description_short>
              <meta_title><language id="1"><![CDATA[Titulo SEO]]></language></meta_title>
              <meta_description><language id="1"><![CDATA[Descripcion SEO]]></language></meta_description>
              <associations>
                <images>
                  <image xlink:href="https://shop.example.com/api/images/products/9/30"><id><![CDATA[30]]></id></image>
                  <image xlink:href="https://shop.example.com/api/images/products/9/31"><id><![CDATA[31]]></id></image>
                </images>
              </associations>
            </product>
          </products>
        </prestashop>`
      });
      const client = makeClient(fake);

      const result = await client.fetchProductsById(['9']);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: '9',
        name: 'Camiseta',
        description: 'Larga',
        description_short: 'Corta',
        meta_title: 'Titulo SEO',
        meta_description: 'Descripcion SEO',
        image_ids: ['30', '31'],
        image_count: 2
      });
    });

    it('still accepts attribute-form ids as a compatibility fallback', async () => {
      const fake = makeFakeClient();
      fake.get.mockResolvedValue({
        data: `<prestashop>
          <products>
            <product id="9">
              <reference><![CDATA[REF-1]]></reference>
              <associations>
                <combinations>
                  <combination id="11" xlink:href="https://shop.example.com/api/combinations/11"/>
                </combinations>
                <images>
                  <image id="30" xlink:href="https://shop.example.com/api/images/products/9/30"/>
                </images>
              </associations>
            </product>
          </products>
        </prestashop>`
      });
      const client = makeClient(fake);

      const result = await client.fetchProductsById(['9']);

      expect(result[0]).toMatchObject({
        id: '9',
        reference: 'REF-1',
        combination_ids: ['11'],
        image_ids: ['30'],
        image_count: 1
      });
    });
  });

  describe('fetchStockByIds', () => {
    it('returns the stock id and quantity for each stock_available', async () => {
      const fake = makeFakeClient();
      fake.get.mockResolvedValue({
        data: `<prestashop>
          <stock_availables>
            <stock_available>
              <id><![CDATA[50]]></id>
              <quantity><![CDATA[7]]></quantity>
            </stock_available>
            <stock_available>
              <id><![CDATA[51]]></id>
              <quantity><![CDATA[2]]></quantity>
            </stock_available>
          </stock_availables>
        </prestashop>`
      });
      const client = makeClient(fake);

      const result = await client.fetchStockByIds(['50', '51']);

      expect(fake.get).toHaveBeenCalledWith('/api/stock_availables', {
        params: { 'filter[id]': '[50|51]', display: 'full', limit: 1000 }
      });
      expect(result).toEqual([
        { id: '50', quantity: 7 },
        { id: '51', quantity: 2 }
      ]);
    });
  });

  describe('fetchStockByProductIds', () => {
    it('returns the stock quantity for each product id', async () => {
      const fake = makeFakeClient();
      fake.get.mockResolvedValue({
        data: `<prestashop>
          <stock_availables>
            <stock_available id="70">
              <id_product><![CDATA[5]]></id_product>
              <quantity><![CDATA[4]]></quantity>
            </stock_available>
          </stock_availables>
        </prestashop>`
      });
      const client = makeClient(fake);

      const result = await client.fetchStockByProductIds(['5']);

      expect(fake.get).toHaveBeenCalledWith('/api/stock_availables', {
        params: { 'filter[id_product]': '[5]', display: 'full', limit: 1000 }
      });
      expect(result).toEqual([{ id_product: '5', quantity: 4 }]);
    });
  });

  describe('fetchProductsByReference', () => {
    it('fetches full product data for the given references with an OR filter', async () => {
      const fake = makeFakeClient();
      fake.get.mockResolvedValue({
        data: `<prestashop>
          <products>
            <product>
              <id><![CDATA[9]]></id>
              <reference><![CDATA[REF-1]]></reference>
              <name><language id="1"><![CDATA[Camiseta]]></language></name>
              <associations>
                <combinations>
                  <combination xlink:href="https://shop.example.com/api/combinations/11"><id><![CDATA[11]]></id></combination>
                  <combination xlink:href="https://shop.example.com/api/combinations/12"><id><![CDATA[12]]></id></combination>
                </combinations>
                <images>
                  <image xlink:href="https://shop.example.com/api/images/products/9/30"><id><![CDATA[30]]></id></image>
                </images>
              </associations>
            </product>
          </products>
        </prestashop>`
      });
      const client = makeClient(fake);

      const result = await client.fetchProductsByReference(['REF-1']);

      expect(fake.get).toHaveBeenCalledWith('/api/products', {
        params: { 'filter[reference]': '[REF-1]', display: 'full', limit: 1000 }
      });
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: '9',
        reference: 'REF-1',
        name: 'Camiseta',
        combination_ids: ['11', '12'],
        image_count: 1
      });
    });
  });

  describe('fetchCombinationsByIds', () => {
    it('fetches the combinations matching any of the given ids', async () => {
      const fake = makeFakeClient();
      fake.get.mockResolvedValue({
        data: `<prestashop>
          <combinations>
            <combination>
              <id><![CDATA[11]]></id>
              <id_product><![CDATA[5]]></id_product>
              <ean13><![CDATA[8412345678901]]></ean13>
              <price>10.000000</price>
              <associations>
                <stock_availables>
                  <stock_available xlink:href="https://shop.example.com/api/stock_availables/50"><id><![CDATA[50]]></id></stock_available>
                </stock_availables>
              </associations>
            </combination>
          </combinations>
        </prestashop>`
      });
      const client = makeClient(fake);

      const result = await client.fetchCombinationsByIds(['11']);

      expect(fake.get).toHaveBeenCalledWith('/api/combinations', {
        params: { 'filter[id]': '[11]', display: 'full', limit: 1000 }
      });
      expect(result).toEqual([
        expect.objectContaining({
          id_product_attribute: '11',
          id_product: '5',
          ean13: '8412345678901',
          stock_available_id: '50'
        })
      ]);
    });
  });

  describe('fetchAllProducts', () => {
    it('fetches the first products of the store with the given limit', async () => {
      const fake = makeFakeClient();
      fake.get.mockResolvedValue({
        data: `<prestashop>
          <products>
            <product>
              <id><![CDATA[9]]></id>
              <reference><![CDATA[REF-1]]></reference>
              <associations>
                <combinations>
                  <combination xlink:href="https://shop.example.com/api/combinations/11"><id><![CDATA[11]]></id></combination>
                </combinations>
                <images>
                  <image xlink:href="https://shop.example.com/api/images/products/9/30"><id><![CDATA[30]]></id></image>
                </images>
              </associations>
            </product>
          </products>
        </prestashop>`
      });
      const client = makeClient(fake);

      const result = await client.fetchAllProducts(200);

      expect(fake.get).toHaveBeenCalledWith('/api/products', {
        params: { display: 'full', limit: 200 }
      });
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: '9',
        reference: 'REF-1',
        combination_ids: ['11'],
        image_count: 1
      });
    });
  });

  describe('fetchManufacturers', () => {
    it('returns the id and plain (non-multilingual) name of every manufacturer', async () => {
      const fake = makeFakeClient();
      fake.get.mockResolvedValue({
        data: `<prestashop>
          <manufacturers>
            <manufacturer>
              <id><![CDATA[3]]></id>
              <name><![CDATA[Marca Uno]]></name>
            </manufacturer>
          </manufacturers>
        </prestashop>`
      });
      const client = makeClient(fake);

      const result = await client.fetchManufacturers();

      expect(fake.get).toHaveBeenCalledWith('/api/manufacturers', {
        params: { display: 'full', limit: 1000 }
      });
      expect(result).toEqual([{ id: '3', name: 'Marca Uno' }]);
    });
  });

  describe('fetchCategories', () => {
    it('returns the id and localized name of every category', async () => {
      const fake = makeFakeClient();
      fake.get.mockResolvedValue({
        data: `<prestashop>
          <categories>
            <category>
              <id><![CDATA[8]]></id>
              <name><language id="1"><![CDATA[Categoria Uno]]></language></name>
            </category>
          </categories>
        </prestashop>`
      });
      const client = makeClient(fake);

      const result = await client.fetchCategories();

      expect(fake.get).toHaveBeenCalledWith('/api/categories', {
        params: { display: 'full', limit: 1000 }
      });
      expect(result).toEqual([{ id: '8', name: 'Categoria Uno' }]);
    });
  });
});
