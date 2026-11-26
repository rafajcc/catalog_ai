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
  variants: { nodes: [{ id: 'v1', sku: 'REF-1', barcode: '123' }] },
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
    // Shopify prices are not requested: they are not editable or saved anywhere.
    expect(p.price).toBeUndefined();
    expect(p.brand).toBe('Adidas');
    expect(p.meta_title).toBe('T');
    expect(p.meta_description).toBe('D');
    expect(p.images).toHaveLength(1);
    // GIDs contain slashes, so they travel in the query string: a reverse
    // proxy must not be able to turn them into extra path segments.
    const imageUrl = p.images![0].url;
    expect(imageUrl).toContain('/api/fetch/shopify/images?');
    expect(imageUrl.split('?')[0]).toBe('/api/fetch/shopify/images');
    expect(imageUrl).toContain(`productId=${encodeURIComponent('gid://shopify/Product/1')}`);
    expect(imageUrl).toContain(`imageId=${encodeURIComponent('gid://shopify/MediaImage/1')}`);
    expect(imageUrl).toContain(encodeURIComponent('https://cdn.shopify.com/a.png'));
  });

  it('flags a product with no description or few images as a warning', async () => {
    const { fetcher } = makeFetcher([
      { hasNextPage: false, nodes: [node({ bodyHtml: '' })] }
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

  it('always requires both reference and brand even when the operator is OR', async () => {
    const { fetcher } = makeFetcher([
      {
        hasNextPage: false,
        nodes: [
          node({ id: 1, vendor: 'Adidas', variants: { nodes: [{ id: 'v1', sku: 'REF-1' }] } }),
          node({ id: 2, vendor: 'Nike', variants: { nodes: [{ id: 'v2', sku: 'REF-2' }] } }),
          node({ id: 3, vendor: 'Nike', variants: { nodes: [{ id: 'v3', sku: 'REF-1' }] } })
        ]
      }
    ]);

    const products = await fetcher.fetch({ references: ['REF-1'], brand: 'Nike', filter_operator: 'or' });

    expect(products.map((p) => p.shopify_id)).toEqual(['gid://shopify/Product/3']);
  });

  it('matches any variant SKU exactly and still shows the canonical reference', async () => {
    const { fetcher, getProducts } = makeFetcher([
      {
        hasNextPage: false,
        nodes: [node({ id: 1, variants: { nodes: [{ id: 'v1', sku: 'REF-1' }, { id: 'v2', sku: 'REF-2' }] } })]
      }
    ]);

    const products = await fetcher.fetch({ references: ['REF-2'] });

    expect(getProducts).toHaveBeenCalledWith(50, undefined, 'sku:"REF-2"');
    expect(products).toHaveLength(1);
    // One row per product: the canonical reference is still the first variant,
    // while the matched SKU is kept only as extra information.
    expect(products[0].reference).toBe('REF-1');
    expect(products[0].matched_reference).toBe('REF-2');
    expect(products[0].variant_skus).toEqual(['REF-1', 'REF-2']);
  });

  it('does not treat a reference as a prefix', async () => {
    const { fetcher } = makeFetcher([
      {
        hasNextPage: false,
        nodes: [node({ id: 1, variants: { nodes: [{ id: 'v1', sku: 'REF-1' }, { id: 'v2', sku: 'REF-2' }] } })]
      }
    ]);

    expect(await fetcher.fetch({ references: ['REF'] })).toHaveLength(0);
  });

  it('never returns the same product twice when Shopify repeats it across pages', async () => {
    const repeated = node({ id: 1 });
    const { fetcher, getProducts } = makeFetcher([
      { hasNextPage: true, endCursor: 'c1', nodes: [repeated] },
      { hasNextPage: false, nodes: [repeated] }
    ]);

    const products = await fetcher.fetch({});

    expect(getProducts).toHaveBeenCalledTimes(2);
    expect(products).toHaveLength(1);
  });

  it('combines SKU and brand into one OR pre-filter', async () => {
    const { fetcher, getProducts } = makeFetcher([{ hasNextPage: false, nodes: [] }]);

    await fetcher.fetch({ references: ['REF-1'], brand: 'Nike Store', filter_operator: 'and' });

    expect(getProducts).toHaveBeenCalledWith(50, undefined, 'sku:"REF-1" OR vendor:nike*');
  });

  it('pre-filters by brand but keeps the local substring check', async () => {
    const { fetcher, getProducts } = makeFetcher([
      {
        hasNextPage: false,
        nodes: [node({ id: 1, vendor: 'NikeAir' }), node({ id: 2, vendor: 'Adidas' })]
      }
    ]);

    const products = await fetcher.fetch({ brand: 'Nike' });

    expect(getProducts).toHaveBeenCalledWith(50, undefined, 'vendor:nike*');
    expect(products.map((p) => p.shopify_id)).toEqual(['gid://shopify/Product/1']);
  });

  it('still applies the reference filter on an OR search without a brand', async () => {
    const { fetcher } = makeFetcher([
      { hasNextPage: false, nodes: [node({ id: 1, variants: { nodes: [{ id: 'v1', sku: 'OTHER' }] } })] }
    ]);

    const products = await fetcher.fetch({ references: ['REF-1'], filter_operator: 'or' });

    expect(products).toHaveLength(0);
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

  it('applies the OR operator only between the description and image filters', async () => {
    const page = {
      hasNextPage: false,
      nodes: [
        node({ id: 1, bodyHtml: '<p>con</p>', media: { nodes: [] } }),
        node({ id: 2, bodyHtml: '', media: { nodes: [{ id: 'm2', image: { url: 'https://x/2.png' } }] } })
      ]
    };

    const either = await makeFetcher([page]).fetcher.fetch({
      references: ['REF-1'],
      description: 'with',
      images: 'with',
      filter_operator: 'or'
    });
    expect(either.map((p) => p.shopify_id)).toEqual([
      'gid://shopify/Product/1',
      'gid://shopify/Product/2'
    ]);

    const both = await makeFetcher([page]).fetcher.fetch({
      description: 'with',
      images: 'with',
      filter_operator: 'and'
    });
    expect(both).toHaveLength(0);
  });

  it('walks pages until 50 products survive the filters', async () => {
    const withImage = (id: number) =>
      node({ id, media: { nodes: [{ id: `m${id}`, image: { url: `https://x/${id}.png` } }] } });
    const pageOne = {
      hasNextPage: true,
      endCursor: 'c1',
      nodes: Array.from({ length: 50 }, (_, i) => node({ id: i + 1, media: { nodes: [] } }))
    };
    const pageTwo = {
      hasNextPage: false,
      endCursor: 'c2',
      nodes: Array.from({ length: 60 }, (_, i) => withImage(i + 100))
    };
    const { fetcher, getProducts } = makeFetcher([pageOne, pageTwo]);

    const products = await fetcher.fetch({ images: 'with' });

    expect(products).toHaveLength(50);
    expect(getProducts).toHaveBeenCalledTimes(2);
    expect(getProducts).toHaveBeenNthCalledWith(1, 50, undefined);
    expect(getProducts).toHaveBeenNthCalledWith(2, 50, 'c1');
  });

  it('stops paging once the catalog is exhausted without reaching the limit', async () => {
    const { fetcher, getProducts } = makeFetcher([
      { hasNextPage: false, nodes: [node({ id: 1, media: { nodes: [] } }) ] }
    ]);

    const products = await fetcher.fetch({ images: 'with' });

    expect(products).toHaveLength(0);
    expect(getProducts).toHaveBeenCalledTimes(1);
  });
});
