import { ProductData, ProductImage } from '../../../../types';
import { ShopifyClient, ShopifyProductNode } from '../../clients/shopify-client/shopify-client';

export interface ShopifyFetchOptions {
  references?: string[];
  brand?: string;
  description?: 'with' | 'without' | 'all';
  images?: 'with' | 'without' | 'all';
  filter_operator?: 'and' | 'or';
  limit?: number;
}

export const SHOPIFY_FETCH_POOL = 50;
const MAX_IMAGES = 20;
const MIN_DESIRED_IMAGES = 5;

// Products requested per GraphQL page. Shopify caps `first` at 50.
const SHOPIFY_PAGE_SIZE = 50;

// Safety ceiling for the paginated walk: how many products are read at most
// when the description/images filters cannot run on the server. Without it, an
// "with images" search on a large catalog could page through the whole store.
export const SHOPIFY_FETCH_MAX_POOL = 5000;

// Shopify search values need the search-syntax special characters escaped.
function escapeShopifySearchValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// Both filters are only pre-filters: Shopify's `sku` matches ANY variant (we
// map only the first one) and its `vendor` matches tokens (we use `includes`).
// Joining every active criterion with OR keeps the result a superset for both
// AND and OR searches, so the local checks below remain the source of truth.
// The brand wildcard avoids losing values such as "NikeAir" when searching
// "Nike"; any extra products it lets through are discarded locally.
function buildShopifySearch(refs: string[], brand?: string): string | undefined {
  const clauses = refs.map((ref) => `sku:"${escapeShopifySearchValue(ref)}"`);
  const brandTerm = brand?.trim().split(/\s+/)[0];
  if (brandTerm) clauses.push(`vendor:${escapeShopifySearchValue(brandTerm)}*`);
  return clauses.length > 0 ? clauses.join(' OR ') : undefined;
}

export class ShopifyFetcher {
  constructor(private readonly client: ShopifyClient) {}

  async fetch(options: ShopifyFetchOptions = {}): Promise<ProductData[]> {
    const limit = options.limit ?? SHOPIFY_FETCH_POOL;
    const rawRefs = (options.references ?? []).map((r) => r.trim()).filter(Boolean);
    const normalizedRefs = rawRefs.map((r) => r.toLowerCase());

    const brandFilter = options.brand?.trim().toLowerCase();
    const hasBrandFilter = brandFilter && brandFilter.length > 0;
    const hasRefFilter = normalizedRefs.length > 0;
    const shopifySearch = buildShopifySearch(rawRefs, brandFilter || undefined);

    // References and brands are pushed to Shopify as pre-filters so we do not
    // walk the whole catalog, but both are still applied locally: SKU against
    // the first variant and brand with `includes`. Descriptions and images are
    // always checked locally too. The walk stops once `limit` products survive
    // every filter or the catalog is exhausted (SHOPIFY_FETCH_MAX_POOL).
    const matchesRef = (node: ShopifyProductNode): boolean => {
      const ref = (node.variants?.nodes?.[0]?.sku ?? '').toLowerCase();
      const brand = (node.vendor ?? '').toLowerCase();
      const refOk = !hasRefFilter || normalizedRefs.includes(ref);
      const brandOk = !hasBrandFilter || brand.includes(brandFilter!);
      // Only criteria actually supplied take part in the operator. Otherwise an
      // OR search with just a reference would match every product because the
      // absent brand filter counts as true.
      const active = [
        ...(hasRefFilter ? [refOk] : []),
        ...(hasBrandFilter ? [brandOk] : [])
      ];
      if (active.length === 0) return true;
      return options.filter_operator === 'or' ? active.some(Boolean) : active.every(Boolean);
    };

    const filtered: ProductData[] = [];
    let hasNextPage = true;
    let cursor: string | undefined;
    let fetched = 0;
    while (hasNextPage && fetched < SHOPIFY_FETCH_MAX_POOL && filtered.length < limit) {
      const pageSize = Math.min(SHOPIFY_PAGE_SIZE, SHOPIFY_FETCH_MAX_POOL - fetched);
      const batch = shopifySearch
        ? await this.client.getProducts(pageSize, cursor, shopifySearch)
        : await this.client.getProducts(pageSize, cursor);
      for (const node of batch.nodes) {
        if (!matchesRef(node)) continue;
        const product = this.mapNode(node);
        if (this.matchesPresence(product, options)) {
          filtered.push(product);
          if (filtered.length >= limit) break;
        }
      }
      hasNextPage = batch.hasNextPage;
      cursor = batch.endCursor;
      fetched += batch.nodes.length;
      if (batch.nodes.length === 0) break;
    }

    return filtered;
  }

  private matchesPresence(product: ProductData, options: ShopifyFetchOptions): boolean {
    if (options.description === 'with' && !(typeof product.description === 'string' && product.description.trim().length > 0)) {
      return false;
    }
    if (options.description === 'without' && product.description && product.description.trim().length > 0) {
      return false;
    }
    if (options.images === 'with' && (product.images?.length ?? 0) === 0) {
      return false;
    }
    if (options.images === 'without' && (product.images?.length ?? 0) > 0) {
      return false;
    }
    return true;
  }

  private mapNode(node: ShopifyProductNode): ProductData {
    const variant = node.variants?.nodes?.[0];
    const images: ProductImage[] = (node.media?.nodes ?? [])
      .filter((m) => m.image?.url)
      .map((m) => ({
        id: m.id,
        product_id: node.id,
        // GIDs contain slashes: keep them in the query string so a reverse proxy
        // cannot decode them into extra path segments before Express sees them.
        url: `/api/fetch/shopify/images?productId=${encodeURIComponent(node.id)}&imageId=${encodeURIComponent(m.id)}&url=${encodeURIComponent(m.image!.url!)}`
      }))
      .slice(0, MAX_IMAGES);

    const description = node.bodyHtml ?? undefined;
    let status = 'ok';
    if ((description ?? '').trim().length === 0 || images.length < MIN_DESIRED_IMAGES) {
      status = 'warning';
    }

    return {
      id: `sh_${node.id}`,
      status,
      source_file: 'Shopify',
      validation_errors: [],
      warnings: [],
      name: node.title,
      reference: variant?.sku,
      ean: variant?.barcode,
      description,
      description_short: undefined,
      meta_title: node.seo?.title,
      meta_description: node.seo?.description,
      brand: node.vendor,
      category: node.productType,
      tax: undefined,
      images,
      is_new: false,
      is_updated: false,
      shopify_id: node.id
    };
  }
}
