// Unit tests for the Shopify marketplace adapter. The ShopifyClient is injected
// through the adapter's optional client factory slot, so these tests exercise
// the adapter logic (fetch + dataset, text/image save, proxy, delete) without
// any HTTP call.
import { createShopifyAdapter } from '../backend/src/modules/marketplaces/adapters';
import { DataStore } from '../backend/src/store';
import type { ShopifyConfig } from '../backend/src/types';

const config: ShopifyConfig = {
  shop_domain: 'mi-tienda.myshopify.com',
  access_token: 'shpat_SECRET',
  api_version: '2026-07'
};

interface FakeShopifyClient {
  testConnection: jest.Mock;
  getProducts: jest.Mock;
  updateProduct: jest.Mock;
  uploadProductImage: jest.Mock;
  deleteProductImage: jest.Mock;
  fetchProductImageBuffer: jest.Mock;
}

function makeFakeClient(): FakeShopifyClient {
  return {
    testConnection: jest.fn().mockResolvedValue(true),
    getProducts: jest.fn(),
    updateProduct: jest.fn().mockResolvedValue(undefined),
    uploadProductImage: jest.fn().mockResolvedValue(undefined),
    deleteProductImage: jest.fn().mockResolvedValue(undefined),
    fetchProductImageBuffer: jest.fn().mockResolvedValue(Buffer.from('image-bytes'))
  };
}

function makeAdapter(fake: FakeShopifyClient, store = new DataStore()) {
  const adapter = createShopifyAdapter(config, store, { clientFactories: { Shopify: () => fake as never } });
  return { adapter, store };
}

const productNode = {
  id: 'gid://shopify/Product/9',
  title: 'Mi producto',
  handle: 'mi-producto',
  bodyHtml: '<p>Descripción</p>',
  vendor: 'Adidas',
  productType: 'Zapatillas',
  seo: { title: 'SEO título', description: 'SEO descripción' },
  variants: { nodes: [{ id: 'v1', sku: 'REF-1', barcode: '123', price: '19.99', inventoryQuantity: 3 }] },
  media: { nodes: [{ id: 'gid://shopify/MediaImage/1', image: { url: 'https://cdn.shopify.com/a.png' } }] }
};

describe('createShopifyAdapter', () => {
  describe('fetch', () => {
    it('maps the products, stores the dataset and returns the summary', async () => {
      const fake = makeFakeClient();
      fake.getProducts.mockResolvedValue({ nodes: [productNode], hasNextPage: false, endCursor: undefined });
      const { adapter, store } = makeAdapter(fake);

      const result = await adapter.fetch({
        references: [],
        brand: '',
        description: 'all',
        images: 'all',
        filter_operator: 'and',
        limit: 50
      });

      expect(result.total).toBe(1);
      expect(result.products[0]).toMatchObject({
        name: 'Mi producto',
        reference: 'REF-1',
        brand: 'Adidas',
        meta_title: 'SEO título',
        shopify_id: 'gid://shopify/Product/9'
      });
      expect(store.getDataset('Shopify')?.products).toHaveLength(1);
      expect(store.getDataset('Shopify')?.dataId).toBe(result.dataId);
    });

    it('throws 404 when no product matches the filters', async () => {
      const fake = makeFakeClient();
      fake.getProducts.mockResolvedValue({ nodes: [], hasNextPage: false });
      const { adapter } = makeAdapter(fake);

      await expect(
        adapter.fetch({ references: [], brand: 'Nadie', description: 'all', images: 'all', filter_operator: 'and', limit: 50 })
      ).rejects.toThrow(/No products matched/i);
    });
  });

  describe('getDataset / clearDataset', () => {
    it('returns null when nothing was fetched and clears the stored dataset', async () => {
      const fake = makeFakeClient();
      const { adapter, store } = makeAdapter(fake);

      expect(adapter.getDataset()).toBeNull();

      store.setDataset('Shopify', { dataId: 'sh_1', fileId: 'sh_1', fileName: 'Shopify', products: [], totalRows: 0 });
      expect(adapter.getDataset()).toMatchObject({ dataId: 'sh_1', total: 0 });

      adapter.clearDataset();
      expect(store.getDataset('Shopify')).toBeUndefined();
    });
  });

  describe('saveUpdates', () => {
    it('updates text fields and maps them to the Shopify input', async () => {
      const fake = makeFakeClient();
      const { adapter } = makeAdapter(fake);

      const result = await adapter.saveUpdates({
        'gid://shopify/Product/9': { description: '<p>Nueva</p>', meta_title: 'T', meta_description: 'D' }
      });

      expect(result.successCount).toBe(1);
      expect(result.results['gid://shopify/Product/9']).toBe(true);
      expect(fake.updateProduct).toHaveBeenCalledWith('gid://shopify/Product/9', {
        bodyHtml: '<p>Nueva</p>',
        seo: { title: 'T', description: 'D' }
      });
    });

    it('uploads base64 images as product media', async () => {
      const fake = makeFakeClient();
      const { adapter } = makeAdapter(fake);
      const data = Buffer.from('binary').toString('base64');

      const result = await adapter.saveUpdates({
        'gid://shopify/Product/9': { images: [{ data, content_type: 'image/png' }] }
      });

      expect(result.successCount).toBe(1);
      expect(fake.updateProduct).not.toHaveBeenCalled();
      expect(fake.uploadProductImage).toHaveBeenCalledWith(
        'gid://shopify/Product/9',
        Buffer.from('binary'),
        'image/png'
      );
    });

    it('deletes the media listed in images_to_delete', async () => {
      const fake = makeFakeClient();
      const { adapter } = makeAdapter(fake);

      const result = await adapter.saveUpdates({
        'gid://shopify/Product/9': { images_to_delete: ['gid://shopify/MediaImage/1'] }
      });

      expect(result.successCount).toBe(1);
      expect(fake.deleteProductImage).toHaveBeenCalledWith('gid://shopify/Product/9', 'gid://shopify/MediaImage/1');
    });

    it('counts a product as failed when every image operation fails', async () => {
      const fake = makeFakeClient();
      fake.uploadProductImage.mockRejectedValue(new Error('media error'));
      const { adapter } = makeAdapter(fake);
      const data = Buffer.from('binary').toString('base64');

      const result = await adapter.saveUpdates({
        'gid://shopify/Product/9': { images: [{ data, content_type: 'image/png' }] }
      });

      expect(result.successCount).toBe(0);
      expect(result.results['gid://shopify/Product/9']).toBe(false);
      expect(result.failures).toContain('media error');
    });

    it('reports a product with no editable fields as a failure', async () => {
      const fake = makeFakeClient();
      const { adapter } = makeAdapter(fake);

      const result = await adapter.saveUpdates({ 'gid://shopify/Product/9': { unknown: 'x' } });

      expect(result.successCount).toBe(0);
      expect(result.results['gid://shopify/Product/9']).toBe(false);
      expect(fake.updateProduct).not.toHaveBeenCalled();
    });
  });

  describe('proxyImage', () => {
    it('decodes the proxied URL and returns the image bytes', async () => {
      const fake = makeFakeClient();
      const { adapter, store } = makeAdapter(fake);
      const remote = 'https://cdn.shopify.com/a.png';
      store.setDataset('Shopify', {
        dataId: 'sh_1',
        fileId: 'sh_1',
        fileName: 'Shopify',
        totalRows: 1,
        products: [
          {
            id: 'sh_gid',
            shopify_id: 'gid://shopify/Product/9',
            images: [
              {
                id: 'gid://shopify/MediaImage/1',
                product_id: 'gid://shopify/Product/9',
                url: `/api/fetch/shopify/images/${encodeURIComponent('gid://shopify/Product/9')}/${encodeURIComponent('gid://shopify/MediaImage/1')}?url=${encodeURIComponent(remote)}`
              }
            ]
          } as never
        ]
      });

      const buffer = await adapter.proxyImage('gid://shopify/Product/9', 'gid://shopify/MediaImage/1');

      expect(fake.fetchProductImageBuffer).toHaveBeenCalledWith(remote);
      expect(buffer).toEqual(Buffer.from('image-bytes'));
    });

    it('throws when the image is not part of the dataset', async () => {
      const fake = makeFakeClient();
      const { adapter } = makeAdapter(fake);

      await expect(adapter.proxyImage('gid://shopify/Product/9', 'gid://shopify/MediaImage/1')).rejects.toThrow(
        /not found/i
      );
    });
  });

  describe('deleteImage', () => {
    it('delegates to the client', async () => {
      const fake = makeFakeClient();
      const { adapter } = makeAdapter(fake);

      await adapter.deleteImage('gid://shopify/Product/9', 'gid://shopify/MediaImage/1');

      expect(fake.deleteProductImage).toHaveBeenCalledWith('gid://shopify/Product/9', 'gid://shopify/MediaImage/1');
    });
  });
});
