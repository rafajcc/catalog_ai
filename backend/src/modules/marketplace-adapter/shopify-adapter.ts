import { AppError } from '../../utils/error-handler';
import { DataStore, SHOPIFY_DEFAULT_API_VERSION } from '../../store';
import { ShopifyConfig } from '../../types';
import { MarketplaceAdapter, MarketplaceFetchFilters, MarketplaceFetchResult, MarketplaceSaveResult } from './types';

// Placeholder adapter: will be implemented in full detail when building the
// Shopify client/fetcher. This keeps the abstraction contract in place and
// avoids breaking existing logic.
export function createShopifyAdapter(config: ShopifyConfig, store: DataStore): MarketplaceAdapter {
  const apiVersion = config.api_version || SHOPIFY_DEFAULT_API_VERSION;

  return {
    async testConnection() {
      // TODO: implementar usando ShopifyClient
      if (!config.shop_domain || !config.access_token) {
        throw new AppError('Shopify debe estar configurado para probar la conexión', 400);
      }
    },
    async fetch(filters: MarketplaceFetchFilters): Promise<MarketplaceFetchResult> {
      // TODO: implementar usando ShopifyClient + ShopifyFetcher
      if (!config.shop_domain || !config.access_token) {
        throw new AppError('Shopify debe estar configurado para obtener productos', 400);
      }
      const dataId = store.newId('sh');
      store.shopifyDataset = {
        dataId,
        fileId: dataId,
        fileName: 'Shopify',
        products: [],
        totalRows: 0
      };
      return { dataId, products: [], total: 0 };
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
      if (!config.shop_domain || !config.access_token) {
        throw new AppError('Shopify debe estar configurado para guardar productos', 400);
      }
      return { successCount: 0, failures: [], results: {} };
    },
    async proxyImage(productId: string, imageId: string): Promise<Buffer> {
      throw new AppError('Shopify image proxy no implementado aún', 501);
    },
    async deleteImage(productId: string, imageId: string): Promise<void> {
      throw new AppError('Shopify image delete no implementado aún', 501);
    }
  };
}
