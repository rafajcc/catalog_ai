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
  eans?: string[];
  references?: string[];
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
