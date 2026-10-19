// Unit tests for the Shopify product fetcher: GraphQL node -> ProductData
// mapping and the front-of-fetch filters (references, brand, description and
// image presence). The ShopifyClient is a plain stub here.
import { ShopifyFetcher } from '../backend/src/modules/marketplaces/fetchers/shopify-fetcher/shopify-fetcher';

function makeFetcher(pages: Array<{ nodes: any[]; hasNextPage: boolean; endCursor?: string }>) {
  const getProducts = jest.fn();
  for (const page of pages) {
    getProducts.mockResolvedValueOnce(page);
  }
  const fetcher = new ShopifyFetcher({ getProducts } as never);
  return { fetcher, getProducts };
}

const node = ({ id = 1, ...over }: Record<string, any> = {}) => ({
  id: `gid://shopify/Product/${id}`,
  title: 'Producto',
  handle: 'producto',
  bodyHtml: '<p>Descripción</p>',
  vendor: 'Adidas',
  productType: 'Zapatillas',
  seo: { title: 'T', description: 'D' },
  variants: { nodes: [{ id: 'v1', sku: 'REF-1', barcode: '123', price: '10.00', inventoryQuantity: 2 }] },
  media: { nodes: [] },
  ...over
});

describe('ShopifyFetcher', () => {
  it('maps a node to ProductData with images proxied through the backend', async () => {
    const { fetcher } = makeFetcher([
      {
        hasNextPage: false,
        nodes: [
          node({
            media: { nodes: [{ id: 'gid://shopify/MediaImage/1', image: { url: 'https://cdn.shopify.com/a.png' } }] }
          })
        ]
      }
    ]);

    const products = await fetcher.fetch({});

    expect(products).toHaveLength(1);
    const p = products[0];
    expect(p.shopify_id).toBe('gid://shopify/Product/1');
    expect(p.name).toBe('Producto');
    expect(p.reference).toBe('REF-1');
    expect(p.ean).toBe('123');
    expect(p.price).toBe(10);
    expect(p.quantity).toBe(2);
    expect(p.brand).toBe('Adidas');
    expect(p.meta_title).toBe('T');
    expect(p.meta_description).toBe('D');
    expect(p.images).toHaveLength(1);
    expect(p.images![0].url).toContain('/api/fetch/shopify/images/');
    expect(p.images![0].url).toContain(encodeURIComponent('https://cdn.shopify.com/a.png'));
  });

  it('flags a product with no description, few images or zero stock as a warning', async () => {
    const { fetcher } = makeFetcher([
      { hasNextPage: false, nodes: [node({ bodyHtml: '', variants: { nodes: [{ id: 'v1', inventoryQuantity: 0 }] } })] }
    ]);

    const products = await fetcher.fetch({});

    expect(products[0].status).toBe('warning');
  });

  it('filters by brand and reference with the AND operator by default', async () => {
    const { fetcher } = makeFetcher([
      {
        hasNextPage: false,
        nodes: [
          node({ id: 1, vendor: 'Adidas', variants: { nodes: [{ id: 'v1', sku: 'REF-1' }] } }),
          node({ id: 2, vendor: 'Nike', variants: { nodes: [{ id: 'v2', sku: 'REF-1' }] } })
        ]
      }
    ]);

    const products = await fetcher.fetch({ references: ['REF-1'], brand: 'Adidas' });

    expect(products.map((p) => p.shopify_id)).toEqual(['gid://shopify/Product/1']);
  });

  it('keeps either match under the OR operator', async () => {
    const { fetcher } = makeFetcher([
      {
        hasNextPage: false,
        nodes: [
          node({ id: 1, vendor: 'Adidas', variants: { nodes: [{ id: 'v1', sku: 'REF-1' }] } }),
          node({ id: 2, vendor: 'Nike', variants: { nodes: [{ id: 'v2', sku: 'REF-2' }] } }),
          node({ id: 3, vendor: 'Puma', variants: { nodes: [{ id: 'v3', sku: 'OTHER' }] } })
        ]
      }
    ]);

    const products = await fetcher.fetch({ references: ['REF-1'], brand: 'Nike', filter_operator: 'or' });

    expect(products.map((p) => p.shopify_id).sort()).toEqual([
      'gid://shopify/Product/1',
      'gid://shopify/Product/2'
    ]);
  });

  it('filters by description and image presence', async () => {
    const page = {
      hasNextPage: false,
      nodes: [
        node({ id: 1, bodyHtml: '<p>con</p>', media: { nodes: [{ id: 'm1', image: { url: 'https://x/a.png' } }] } }),
        node({ id: 2, bodyHtml: '', media: { nodes: [] } })
      ]
    };

    const withoutImages = await makeFetcher([page]).fetcher.fetch({ images: 'without' });
    expect(withoutImages.map((p) => p.shopify_id)).toEqual(['gid://shopify/Product/2']);

    const withDescription = await makeFetcher([page]).fetcher.fetch({ description: 'with' });
    expect(withDescription.map((p) => p.shopify_id)).toEqual(['gid://shopify/Product/1']);
  });
});
