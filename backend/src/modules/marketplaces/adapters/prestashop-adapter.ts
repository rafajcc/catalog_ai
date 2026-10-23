import { AppError } from '../../../utils/error-handler';
import { DataStore } from '../../../store';
import { PrestaShopConfig } from '../../../types';
import { PrestaShopFetcher, PRESTASHOP_FETCH_LIMIT } from '../fetchers/prestashop-fetcher/prestashop-fetcher';
import { PrestaShopClient } from '../clients/prestashop-client/prestashop-client';
import { translateMarketplaceError } from './errors';
import { extractImagesToDelete, sanitizePrestashopUpdate } from './sanitize';
import { MarketplaceAdapter, MarketplaceFetchFilters, MarketplaceFetchResult, MarketplaceSaveResult } from './types';
import { MarketplaceCreateContext } from './registry';

export function createPrestashopAdapter(
  config: PrestaShopConfig,
  store: DataStore,
  ctx: MarketplaceCreateContext = {}
): MarketplaceAdapter {
  let client: PrestaShopClient | undefined;
  let fetcher: PrestaShopFetcher | undefined;

  function ensureClient() {
    if (!client) {
      // The contract keeps the factory opaque (`never` config); the owning
      // adapter is the one that knows the concrete client type to build.
      const factory = ctx.clientFactories?.PrestaShop as
        | ((config: PrestaShopConfig) => PrestaShopClient)
        | undefined;
      client = factory ? factory(config) : new PrestaShopClient(config);
      fetcher = new PrestaShopFetcher(client);
    }
    return { client, fetcher: fetcher! };
  }

  return {
    name: 'PrestaShop',
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
        limit: filters.limit ?? PRESTASHOP_FETCH_LIMIT
      });
      if (products.length === 0) {
        throw new AppError('No products matched the given criteria', 404);
      }
      const dataId = store.newId('ps');
      store.setDataset('PrestaShop', {
        dataId,
        fileId: dataId,
        fileName: 'PrestaShop',
        products,
        totalRows: products.length
      });
      return { dataId, products, total: products.length };
    },
    getDataset(): MarketplaceFetchResult | null {
      const dataset = store.getDataset('PrestaShop');
      if (!dataset) return null;
      return { dataId: dataset.dataId, products: dataset.products, total: dataset.totalRows };
    },
    clearDataset() {
      store.setDataset('PrestaShop', undefined);
    },
    async saveUpdates(updates: Record<string, unknown>): Promise<MarketplaceSaveResult> {
      const { client } = ensureClient();
      const entries = Object.entries(updates);
      const results: Record<string, boolean> = {};
      const failures: string[] = [];
      let successCount = 0;

      for (const [productId, rawFields] of entries) {
        const fields = sanitizePrestashopUpdate(rawFields);
        const images = fields.images;
        delete (fields as any).images;
        const imagesToDelete: string[] = extractImagesToDelete((rawFields as Record<string, unknown>)?.images_to_delete);
        const hasTextFields = Object.keys(fields).length > 0;
        const hasImages = Array.isArray(images) && images.length > 0;
        const hasDeletions = imagesToDelete.length > 0;

        if (!hasTextFields && !hasImages && !hasDeletions) {
          results[productId] = false;
          failures.push(`no editable fields for product ${productId}`);
          continue;
        }
        try {
          if (hasTextFields) {
            await client.updateProduct(productId, fields);
          }
          let imageFailCount = 0;
          if (hasDeletions) {
            for (const imageId of imagesToDelete) {
              try {
                await client.deleteProductImage(productId, imageId);
              } catch (delError) {
                imageFailCount += 1;
                failures.push(translateMarketplaceError(delError, 'PrestaShop'));
              }
            }
          }
          if (hasImages) {
            for (const img of images!) {
              try {
                const buffer = Buffer.from(img.data, 'base64');
                await client.uploadProductImage(productId, buffer, img.content_type);
              } catch (imgError) {
                imageFailCount += 1;
                failures.push(translateMarketplaceError(imgError, 'PrestaShop'));
              }
            }
          }
          const totalImageOps = imagesToDelete.length + (images?.length ?? 0);
          const allImagesFailed = totalImageOps > 0 && imageFailCount === totalImageOps;
          results[productId] = !allImagesFailed;
          if (!allImagesFailed) successCount += 1;
        } catch (error) {
          results[productId] = false;
          failures.push(translateMarketplaceError(error, 'PrestaShop'));
        }
      }
      return { successCount, failures, results };
    },
    async proxyImage(productId: string, imageId: string): Promise<Buffer> {
      const { client } = ensureClient();
      return client.fetchProductImage(productId, imageId);
    },
    async deleteImage(productId: string, imageId: string): Promise<void> {
      const { client } = ensureClient();
      await client.deleteProductImage(productId, imageId);
    }
  };
}
