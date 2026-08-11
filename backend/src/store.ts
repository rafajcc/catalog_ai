// In-memory data store for the Catalog AI API.
// State is scoped to a single app instance so every createApp() call starts clean.

import { nanoid } from 'nanoid';
import { AIConfig, PrestaShopConfig, ProductData } from './types';

export interface DataSet {
  dataId: string;
  fileId: string;
  fileName: string;
  products: ProductData[];
  totalRows: number;
}

export interface CatalogConfig {
  prestashop: PrestaShopConfig;
  ai: AIConfig;
}

function defaultConfig(): CatalogConfig {
  return {
    prestashop: { base_url: '', api_key: '', version: '1.7', language_id: 1 },
    ai: { provider: 'mock', language: 'es', enabled_fields: ['name', 'description'] }
  };
}

export class DataStore {
  // Working dataset fetched from the PrestaShop Webservice.
  prestashopDataset: DataSet | undefined = undefined;
  config: CatalogConfig = defaultConfig();

  newId(prefix = 'data'): string {
    return `${prefix}_${nanoid(8)}`;
  }
}
