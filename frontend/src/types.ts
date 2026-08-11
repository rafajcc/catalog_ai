// Shared type definitions for Catalog AI frontend

export type AIProviderName = 'openai' | 'anthropic' | 'openrouter' | 'mock';

export type AIContentField =
  | 'name'
  | 'description_short'
  | 'description'
  | 'meta_title'
  | 'meta_description'
  | 'link_rewrite';

export interface AIConfig {
  provider: AIProviderName;
  model?: string;
  api_key?: string;
  language?: string;
  enabled_fields: AIContentField[];
  max_requests_per_minute?: number;
  temperature?: number;
  // Effective endpoint of the configured provider; read-only on the UI.
  base_url?: string;
  // Custom prompt used to ask an AI to propose product field values. When empty
  // or unset, the system default prompt is used.
  default_prompt?: string;
}

export interface PrestaShopConfig {
  base_url: string;
  api_key: string;
  version: string;
  language_id: number;
  timeout?: number;
}

// PrestaShop Webservice fetch criteria.
export type PrestaShopPresenceFilter = 'with' | 'without' | 'all';

// Combines the description and images criteria: 'and' requires every active
// criterion to match, 'or' accepts products matching at least one.
export type PrestaShopFilterOperator = 'and' | 'or';

export interface PrestaShopFetchRequest {
  references?: string[];
  brand?: string;
  description?: PrestaShopPresenceFilter;
  images?: PrestaShopPresenceFilter;
  filter_operator?: PrestaShopFilterOperator;
  limit?: number;
}

export interface PrestaShopUploadStatus {
  present: boolean;
  dataId?: string;
  count?: number;
}

// An image associated with a PrestaShop product. `url` is a backend-relative
// path that proxies the binary from the PrestaShop Webservice.
export interface PrestaShopProductImage {
  id: string;
  product_id: string;
  url: string;
}

// One imported product row as returned by the PrestaShop fetch endpoints.
export interface ImportedProduct {
  id: string;
  name: string;
  reference?: string;
  ean?: string;
  description?: string;
  description_short?: string;
  meta_title?: string;
  meta_description?: string;
  brand?: string;
  category?: string;
  price?: number;
  quantity?: number;
  images?: PrestaShopProductImage[];
  // The raw PrestaShop product id, used when pushing edits back to the shop.
  prestashop_id?: string;
}

// In-memory user edits applied on top of the imported products, keyed by
// product id. Only the text fields the user can overwrite in the product
// editor are stored; when saved to PrestaShop, only these fields are sent.
export interface ProductEdits {
  description_short?: string;
  description?: string;
  meta_title?: string;
  meta_description?: string;
}

export type ProductEditsMap = Record<string, ProductEdits>;

// API response envelopes
export interface ApiResponse {
  success: boolean;
  message?: string;
  data?: any;
  error?: string;
}

export interface ConfigurationResponse extends ApiResponse {
  prestashop?: PrestaShopConfig;
  ai?: AIConfig;
}
