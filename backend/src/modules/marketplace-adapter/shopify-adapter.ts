import { AppError } from '../../utils/error-handler';
import { DataStore } from '../../store';
import { ProductImageUpload, ShopifyConfig } from '../../types';
import { MarketplaceAdapter, MarketplaceFetchFilters, MarketplaceFetchResult, MarketplaceSaveResult } from './types';
import { ShopifyClient } from '../shopify-client/shopify-client';
import { ShopifyFetcher } from '../shopify-fetcher/shopify-fetcher';

export function createShopifyAdapter(
  config: ShopifyConfig,
  store: DataStore,
  clientFactory?: (config: ShopifyConfig) => ShopifyClient
): MarketplaceAdapter {
  let client: ShopifyClient | undefined;
  let fetcher: ShopifyFetcher | undefined;

  function ensureClient() {
    if (!client) {
      client = clientFactory ? clientFactory(config) : new ShopifyClient(config);
      fetcher = new ShopifyFetcher(client);
    }
    return { client, fetcher: fetcher! };
  }

  return {
    async testConnection() {
      const { client } = ensureClient();
      await client.testConnection();
    },
    async fetch(filters: MarketplaceFetchFilters): Promise<MarketplaceFetchResult> {
      const { fetcher } = ensureClient();
      const products = await fetcher.fetch({
        references: filters.references,
        brand: filters.brand,
        description: filters.description,
        images: filters.images,
        filter_operator: filters.filter_operator,
        limit: filters.limit
      });
      if (products.length === 0) {
        throw new AppError('No products matched the given criteria', 404);
      }
      const dataId = store.newId('sh');
      store.shopifyDataset = {
        dataId,
        fileId: dataId,
        fileName: 'Shopify',
        products,
        totalRows: products.length
      };
      return { dataId, products, total: products.length };
    },
    getDataset(): MarketplaceFetchResult | null {
      const dataset = store.shopifyDataset;
      if (!dataset) return null;
      return { dataId: dataset.dataId, products: dataset.products, total: dataset.totalRows };
    },
    clearDataset() {
      store.shopifyDataset = undefined;
    },
    async saveUpdates(updates: Record<string, unknown>): Promise<MarketplaceSaveResult> {
      const { client } = ensureClient();
      const entries = Object.entries(updates);
      const results: Record<string, boolean> = {};
      const failures: string[] = [];
      let successCount = 0;

      for (const [productId, rawFields] of entries) {
        const source = rawFields as Record<string, any>;
        const textFields = sanitizeForShopify(source);
        const images: ProductImageUpload[] = Array.isArray(source.images)
          ? (source.images as unknown[]).filter(
              (img): img is ProductImageUpload =>
                Boolean(img) &&
                typeof (img as ProductImageUpload).data === 'string' &&
                typeof (img as ProductImageUpload).content_type === 'string'
            )
          : [];
        const imagesToDelete: string[] = Array.isArray(source.images_to_delete)
          ? (source.images_to_delete as unknown[]).filter((id): id is string => typeof id === 'string')
          : [];

        const hasTextFields = Object.keys(textFields).length > 0;
        const hasImages = images.length > 0;
        const hasDeletions = imagesToDelete.length > 0;

        if (!hasTextFields && !hasImages && !hasDeletions) {
          results[productId] = false;
          failures.push(`no editable fields for product ${productId}`);
          continue;
        }

        try {
          if (hasTextFields) {
            await client.updateProduct(productId, textFields);
          }
          let imageFailCount = 0;
          for (const imageId of imagesToDelete) {
            try {
              await client.deleteProductImage(productId, imageId);
            } catch (error) {
              imageFailCount += 1;
              failures.push(describeError(error));
            }
          }
          for (const image of images) {
            try {
              await client.uploadProductImage(productId, Buffer.from(image.data, 'base64'), image.content_type);
            } catch (error) {
              imageFailCount += 1;
              failures.push(describeError(error));
            }
          }
          const totalImageOps = imagesToDelete.length + images.length;
          const allImagesFailed = totalImageOps > 0 && imageFailCount === totalImageOps;
          results[productId] = !allImagesFailed;
          if (!allImagesFailed) successCount += 1;
        } catch (error) {
          results[productId] = false;
          failures.push(describeError(error));
        }
      }
      return { successCount, failures, results };
    },
    async proxyImage(productId: string, imageId: string): Promise<Buffer> {
      const { client } = ensureClient();
      const dataset = store.shopifyDataset;
      const prod = dataset?.products.find((p) => p.shopify_id === productId || p.id === `sh_${productId}`);
      const img = prod?.images?.find((i) => i.id === imageId);
      const url = img?.url ? decodeProxyUrl(img.url) : undefined;
      if (!url) throw new AppError('Shopify image not found', 404);
      return client.fetchProductImageBuffer(url);
    },
    async deleteImage(productId: string, imageId: string): Promise<void> {
      const { client } = ensureClient();
      await client.deleteProductImage(productId, imageId);
    }
  };
}

function sanitizeForShopify(source: Record<string, any>): Record<string, any> {
  const input: Record<string, any> = {};
  if (typeof source.title === 'string' || typeof source.name === 'string') {
    input.title = typeof source.title === 'string' ? source.title : source.name;
  }
  if (typeof source.bodyHtml === 'string') input.bodyHtml = source.bodyHtml;
  if (typeof source.description === 'string') input.bodyHtml = source.description;
  if (source.seo && typeof source.seo === 'object') {
    input.seo = {};
    if (typeof source.seo.title === 'string') input.seo.title = source.seo.title;
    if (typeof source.seo.description === 'string') input.seo.description = source.seo.description;
  }
  if (typeof source.meta_title === 'string') {
    if (!input.seo) input.seo = {};
    input.seo.title = source.meta_title;
  }
  if (typeof source.meta_description === 'string') {
    if (!input.seo) input.seo = {};
    input.seo.description = source.meta_description;
  }
  if (typeof source.handle === 'string') input.handle = source.handle;
  return input;
}

function decodeProxyUrl(url: string): string | undefined {
  try {
    const u = new URL(url, 'http://localhost');
    return u.searchParams.get('url') ?? undefined;
  } catch {
    return undefined;
  }
}

function describeError(error: unknown): string {
  if (error instanceof AppError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}
