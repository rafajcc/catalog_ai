import { MarketplaceName, ProductData } from '../../types';

// Every marketplace the adapter registry can resolve. `Mock` is a canned
// implementation for demos and tests; it is not a real shop, so it is not part
// of the MarketplaceName that CatalogConfig.active_marketplace can hold.
export type RegisteredMarketplace = MarketplaceName | 'Mock';

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
