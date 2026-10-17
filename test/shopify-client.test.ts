// Unit tests for the Shopify Admin GraphQL client. The HTTP layer is mocked at
// the axios boundary (the same pattern as prestashop-client.test.ts): `axios.create`
// returns a fake instance for the shop calls and `axios.post` is stubbed for the
// external staged-upload endpoint.
import axios from 'axios';
import { ShopifyClient } from '../backend/src/modules/shopify-client/shopify-client';
import type { ShopifyConfig } from '../backend/src/types';

jest.mock('axios', () => ({
  __esModule: true,
  default: { create: jest.fn(), post: jest.fn() }
}));

const mockAxiosCreate = axios.create as jest.Mock;
const mockAxiosPost = axios.post as jest.Mock;

const baseConfig: ShopifyConfig = {
  shop_domain: 'mi-tienda.myshopify.com',
  access_token: 'shpat_SECRET',
  api_version: '2026-07'
};

interface FakeClient {
  post: jest.Mock;
  responseErrorHandler?: (error: any) => Promise<any>;
}

function makeFakeClient(): FakeClient {
  const fake: FakeClient = { post: jest.fn() };
  (fake as any).interceptors = {
    response: {
      use: jest.fn((_ok: any, err?: any) => {
        fake.responseErrorHandler = err;
      })
    }
  };
  return fake;
}

function makeClient(fake: FakeClient, config: ShopifyConfig = baseConfig): ShopifyClient {
  mockAxiosCreate.mockReturnValue(fake as never);
  return new ShopifyClient(config);
}

describe('ShopifyClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('creates an axios instance with the shop base URL, the token header and a default timeout', () => {
      const fake = makeFakeClient();

      makeClient(fake);

      expect(mockAxiosCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: 'https://mi-tienda.myshopify.com/admin/api/2026-07',
          timeout: 30000,
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': 'shpat_SECRET'
          })
        })
      );
    });

    it('falls back to the default API version when none is provided', () => {
      const fake = makeFakeClient();

      makeClient(fake, { ...baseConfig, api_version: '' });

      expect(mockAxiosCreate).toHaveBeenCalledWith(
        expect.objectContaining({ baseURL: 'https://mi-tienda.myshopify.com/admin/api/2026-07' })
      );
    });

    it('throws when the shop domain or the token is missing', () => {
      expect(() => makeClient(makeFakeClient(), { ...baseConfig, shop_domain: '' })).toThrow(/configurado/i);
      expect(() => makeClient(makeFakeClient(), { ...baseConfig, access_token: '' })).toThrow(/configurado/i);
    });
  });

  describe('testConnection', () => {
    it('posts the shop query and resolves to true', async () => {
      const fake = makeFakeClient();
      const client = makeClient(fake);
      fake.post.mockResolvedValue({ data: { data: { shop: { name: 'Mi Tienda' } } } });

      await expect(client.testConnection()).resolves.toBe(true);
      expect(fake.post).toHaveBeenCalledWith('/graphql.json', expect.objectContaining({ query: expect.stringContaining('shop') }));
    });

    it('throws an AppError with the GraphQL message when the API returns errors', async () => {
      const fake = makeFakeClient();
      const client = makeClient(fake);
      fake.post.mockResolvedValue({ data: { errors: [{ message: 'Invalid token' }] } });

      await expect(client.testConnection()).rejects.toThrow('Invalid token');
    });
  });

  describe('getProducts', () => {
    it('maps the connection, the page info and clamps the page size', async () => {
      const fake = makeFakeClient();
      const client = makeClient(fake);
      fake.post.mockResolvedValue({
        data: {
          data: {
            products: {
              pageInfo: { hasNextPage: true, endCursor: 'CURSOR-1' },
              nodes: [{ id: 'gid://shopify/Product/1', title: 'Producto', handle: 'producto' }]
            }
          }
        }
      });

      const result = await client.getProducts(500);

      expect(result.nodes).toHaveLength(1);
      expect(result.hasNextPage).toBe(true);
      expect(result.endCursor).toBe('CURSOR-1');
      // The page size is clamped to Shopify's maximum of 50.
      expect(fake.post).toHaveBeenCalledWith(
        '/graphql.json',
        expect.objectContaining({ variables: { first: 50 } })
      );
    });

    it('forwards the pagination cursor', async () => {
      const fake = makeFakeClient();
      const client = makeClient(fake);
      fake.post.mockResolvedValue({ data: { data: { products: { pageInfo: { hasNextPage: false }, nodes: [] } } } });

      await client.getProducts(10, 'CURSOR-9');

      expect(fake.post).toHaveBeenCalledWith(
        '/graphql.json',
        expect.objectContaining({ variables: { first: 10, after: 'CURSOR-9' } })
      );
    });
  });

  describe('updateProduct', () => {
    it('posts the productUpdate mutation with the input', async () => {
      const fake = makeFakeClient();
      const client = makeClient(fake);
      fake.post.mockResolvedValue({ data: { data: { productUpdate: { product: { id: 'gid://shopify/Product/1' }, userErrors: [] } } } });

      await client.updateProduct('gid://shopify/Product/1', { title: 'Nuevo' });

      expect(fake.post).toHaveBeenCalledWith(
        '/graphql.json',
        expect.objectContaining({
          variables: { input: { id: 'gid://shopify/Product/1', title: 'Nuevo' } }
        })
      );
    });

    it('throws when the mutation reports userErrors', async () => {
      const fake = makeFakeClient();
      const client = makeClient(fake);
      fake.post.mockResolvedValue({ data: { data: { productUpdate: { userErrors: [{ field: ['title'], message: 'Title is invalid' }] } } } });

      await expect(client.updateProduct('gid://shopify/Product/1', { title: '' })).rejects.toThrow('Title is invalid');
    });
  });

  describe('deleteProductImage', () => {
    it('posts the productDeleteMedia mutation with the media id', async () => {
      const fake = makeFakeClient();
      const client = makeClient(fake);
      fake.post.mockResolvedValue({ data: { data: { productDeleteMedia: { deletedMediaIds: ['m1'], userErrors: [] } } } });

      await client.deleteProductImage('gid://shopify/Product/1', 'gid://shopify/MediaImage/2');

      expect(fake.post).toHaveBeenCalledWith(
        '/graphql.json',
        expect.objectContaining({
          variables: { productId: 'gid://shopify/Product/1', mediaIds: ['gid://shopify/MediaImage/2'] }
        })
      );
    });
  });

  describe('uploadProductImage', () => {
    it('stages the upload, pushes the binary and attaches the media', async () => {
      const fake = makeFakeClient();
      const client = makeClient(fake);
      // 1) stagedUploadsCreate, 2) productCreateMedia
      fake.post
        .mockResolvedValueOnce({
          data: {
            data: {
              stagedUploadsCreate: {
                stagedTargets: [
                  {
                    url: 'https://shopify-staged-uploads.storage.googleapis.com/',
                    resourceUrl: 'https://shopify-staged-uploads.storage.googleapis.com/resource',
                    parameters: [
                      { name: 'key', value: 'tmp/1' },
                      { name: 'policy', value: 'POLICY' }
                    ]
                  }
                ],
                userErrors: []
              }
            }
          }
        })
        .mockResolvedValueOnce({ data: { data: { productCreateMedia: { media: [{ id: 'm1' }], mediaUserErrors: [] } } } });
      mockAxiosPost.mockResolvedValue({ status: 200 });

      await client.uploadProductImage('gid://shopify/Product/1', Buffer.from([1, 2, 3]), 'image/png');

      // The staged target is requested with the PRODUCT_IMAGE resource.
      expect(fake.post).toHaveBeenNthCalledWith(
        1,
        '/graphql.json',
        expect.objectContaining({
          variables: expect.objectContaining({
            input: [expect.objectContaining({ resource: 'PRODUCT_IMAGE', mimeType: 'image/png', httpMethod: 'POST' })]
          })
        })
      );
      // The binary is pushed to the external staged URL (no shop token there).
      expect(mockAxiosPost).toHaveBeenCalledWith(
        'https://shopify-staged-uploads.storage.googleapis.com/',
        expect.anything(),
        expect.objectContaining({ maxContentLength: Infinity, maxBodyLength: Infinity })
      );
      // Finally the media is attached using the returned resourceUrl.
      expect(fake.post).toHaveBeenNthCalledWith(
        2,
        '/graphql.json',
        expect.objectContaining({
          variables: expect.objectContaining({
            productId: 'gid://shopify/Product/1',
            media: [{ originalSource: 'https://shopify-staged-uploads.storage.googleapis.com/resource', mediaContentType: 'IMAGE' }]
          })
        })
      );
    });

    it('throws when the staged upload cannot be created', async () => {
      const fake = makeFakeClient();
      const client = makeClient(fake);
      fake.post.mockResolvedValue({ data: { data: { stagedUploadsCreate: { stagedTargets: [], userErrors: [] } } } });

      await expect(client.uploadProductImage('gid://shopify/Product/1', Buffer.from([1]), 'image/png')).rejects.toThrow(
        /preparar la subida/i
      );
      expect(mockAxiosPost).not.toHaveBeenCalled();
    });

    it('throws when attaching the media reports userErrors', async () => {
      const fake = makeFakeClient();
      const client = makeClient(fake);
      fake.post
        .mockResolvedValueOnce({
          data: {
            data: {
              stagedUploadsCreate: {
                stagedTargets: [{ url: 'https://u', resourceUrl: 'https://r', parameters: [] }],
                userErrors: []
              }
            }
          }
        })
        .mockResolvedValueOnce({ data: { data: { productCreateMedia: { mediaUserErrors: [{ field: ['media'], message: 'Media too large' }] } } } });
      mockAxiosPost.mockResolvedValue({ status: 200 });

      await expect(client.uploadProductImage('gid://shopify/Product/1', Buffer.from([1]), 'image/jpeg')).rejects.toThrow(
        'Media too large'
      );
    });
  });
});
