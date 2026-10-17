import { ProductData } from '../../types';

export type MarketplaceName = 'PrestaShop' | 'Shopify';

export interface MarketplaceFetchFilters {
  references: string[];
  brand: string;
  description: 'with' | 'without' | 'all';
  images: 'with' | 'without' | 'all';
  filter_operator: 'and' | 'or';
  limit: number;
}

export interface MarketplaceFetchResult {
  dataId: string;
  products: ProductData[];
  total: number;
}

export interface MarketplaceSaveResult {
  successCount: number;
  failures: string[];
  results: Record<string, boolean>;
}

export interface MarketplaceAdapter {
  testConnection(): Promise<void>;
  fetch(filters: MarketplaceFetchFilters): Promise<MarketplaceFetchResult>;
  getDataset(): MarketplaceFetchResult | null;
  clearDataset(): void;
  saveUpdates(updates: Record<string, unknown>): Promise<MarketplaceSaveResult>;
  proxyImage(productId: string, imageId: string): Promise<Buffer>;
  deleteImage(productId: string, imageId: string): Promise<void>;
}
