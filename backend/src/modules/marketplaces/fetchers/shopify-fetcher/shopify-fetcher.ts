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

export class ShopifyFetcher {
  constructor(private readonly client: ShopifyClient) {}

  async fetch(options: ShopifyFetchOptions = {}): Promise<ProductData[]> {
    const limit = options.limit ?? SHOPIFY_FETCH_POOL;
    const normalizedRefs = (options.references ?? [])
      .map((r) => r.trim())
      .filter(Boolean)
      .map((r) => r.toLowerCase());

    let allNodes: ShopifyProductNode[] = [];
    let hasNextPage = true;
    let cursor: string | undefined;
    let fetched = 0;
    while (hasNextPage && fetched < limit) {
      const batch = await this.client.getProducts(Math.min(10, limit - fetched), cursor);
      allNodes = allNodes.concat(batch.nodes);
      hasNextPage = batch.hasNextPage;
      cursor = batch.endCursor;
      fetched += batch.nodes.length;
      if (batch.nodes.length === 0) break;
    }

    const brandFilter = options.brand?.trim().toLowerCase();
    const hasBrandFilter = brandFilter && brandFilter.length > 0;
    const hasRefFilter = normalizedRefs.length > 0;

    let nodes = allNodes;
    if (hasRefFilter || hasBrandFilter) {
      nodes = nodes.filter((node) => {
        const ref = (node.variants?.nodes?.[0]?.sku ?? '').toLowerCase();
        const brand = (node.vendor ?? '').toLowerCase();
        const matchesRef = !hasRefFilter || normalizedRefs.includes(ref);
        const matchesBrand = !hasBrandFilter || brand.includes(brandFilter);
        if (options.filter_operator === 'or') {
          return matchesRef || matchesBrand;
        }
        return matchesRef && matchesBrand;
      });
    }

    const mapped = nodes.map((node) => this.mapNode(node));
    let filtered = mapped;
    if (options.description === 'with') {
      filtered = filtered.filter((p) => typeof p.description === 'string' && p.description.trim().length > 0);
    } else if (options.description === 'without') {
      filtered = filtered.filter((p) => !p.description || p.description.trim().length === 0);
    }
    if (options.images === 'with') {
      filtered = filtered.filter((p) => (p.images?.length ?? 0) > 0);
    } else if (options.images === 'without') {
      filtered = filtered.filter((p) => !p.images || p.images.length === 0);
    }
    if (limit) {
      filtered = filtered.slice(0, limit);
    }
    return filtered;
  }

  private mapNode(node: ShopifyProductNode): ProductData {
    const variant = node.variants?.nodes?.[0];
    const images: ProductImage[] = (node.media?.nodes ?? [])
      .filter((m) => m.image?.url)
      .map((m) => ({
        id: m.id,
        product_id: node.id,
        url: `/api/fetch/shopify/images/${encodeURIComponent(node.id)}/${encodeURIComponent(m.id)}?url=${encodeURIComponent(m.image!.url!)}`
      }))
      .slice(0, MAX_IMAGES);

    const quantity = (node.variants?.nodes ?? [])
      .reduce((sum, v) => sum + (v.inventoryQuantity ?? 0), 0);

    const description = node.bodyHtml ?? undefined;
    let status = 'ok';
    if ((description ?? '').trim().length === 0 || (images.length < MIN_DESIRED_IMAGES) || quantity === 0) {
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
      price: variant?.price ? Number(variant.price) : undefined,
      quantity,
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
