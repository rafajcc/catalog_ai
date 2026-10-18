import { AppError } from '../../utils/error-handler';
import { DataStore } from '../../store';
import { ProductImageUpload, ShopifyConfig } from '../../types';
import { ShopifyClient } from '../shopify-client/shopify-client';
import { ShopifyFetcher } from '../shopify-fetcher/shopify-fetcher';
import { extractImageUploads, extractImagesToDelete, sanitizeShopifyUpdate } from './sanitize';
import { MarketplaceAdapter, MarketplaceFetchFilters, MarketplaceFetchResult, MarketplaceSaveResult } from './types';
import { MarketplaceCreateContext } from './registry';

export function createShopifyAdapter(
  config: ShopifyConfig,
  store: DataStore,
  ctx: MarketplaceCreateContext = {}
): MarketplaceAdapter {
  let client: ShopifyClient | undefined;
  let fetcher: ShopifyFetcher | undefined;

  function ensureClient() {
    if (!client) {
      client = ctx.shopifyClientFactory ? ctx.shopifyClientFactory(config) : new ShopifyClient(config);
      fetcher = new ShopifyFetcher(client);
    }
    return { client, fetcher: fetcher! };
  }

  return {
    name: 'Shopify',
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
      store.setDataset('Shopify', {
        dataId,
        fileId: dataId,
        fileName: 'Shopify',
        products,
        totalRows: products.length
      });
      return { dataId, products, total: products.length };
    },
    getDataset(): MarketplaceFetchResult | null {
      const dataset = store.getDataset('Shopify');
      if (!dataset) return null;
      return { dataId: dataset.dataId, products: dataset.products, total: dataset.totalRows };
    },
    clearDataset() {
      store.setDataset('Shopify', undefined);
    },
    async saveUpdates(updates: Record<string, unknown>): Promise<MarketplaceSaveResult> {
      const { client } = ensureClient();
      const entries = Object.entries(updates);
      const results: Record<string, boolean> = {};
      const failures: string[] = [];
      let successCount = 0;

      for (const [productId, rawFields] of entries) {
        const source = rawFields as Record<string, any>;
        const textFields = sanitizeShopifyUpdate(source);
        const images: ProductImageUpload[] = extractImageUploads(source.images);
        const imagesToDelete: string[] = extractImagesToDelete(source.images_to_delete);

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
      const dataset = store.getDataset('Shopify');
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
