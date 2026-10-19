import { MarketplaceName, ProductData } from '../../../types';

// Every marketplace the adapter registry can resolve, i.e. every value that
// CatalogConfig.active_marketplace can hold. `Mock` is a canned implementation
// for demos and tests: it is not a real shop, but it is selectable like the
// rest so the flow can be tried without external credentials.
export type RegisteredMarketplace = MarketplaceName;

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

// The contract every marketplace implements. The core (routes) only ever sees
// this interface; concrete platform knowledge stays inside each adapter, so a
// new marketplace can be added by implementing it and registering it.
export interface MarketplaceAdapter {
  readonly name: RegisteredMarketplace;
  testConnection(): Promise<void>;
  fetch(filters: MarketplaceFetchFilters): Promise<MarketplaceFetchResult>;
  getDataset(): MarketplaceFetchResult | null;
  clearDataset(): void;
  saveUpdates(updates: Record<string, unknown>): Promise<MarketplaceSaveResult>;
  proxyImage(productId: string, imageId: string): Promise<Buffer>;
  deleteImage(productId: string, imageId: string): Promise<void>;
}
