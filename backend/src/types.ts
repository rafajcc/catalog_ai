// Shared type definitions for Catalog AI

export type Severity = 'error' | 'warning';

export interface ValidationError {
  field: string;
  message: string;
  code: string;
  severity: Severity;
  value?: any;
}

export interface ProductData {
  id: string;
  status: string;
  source_file: string;
  validation_errors: ValidationError[];
  warnings: string[];
  name: string;
  reference?: string;
  ean?: string;
  description?: string;
  description_short?: string;
  meta_title?: string;
  meta_description?: string;
  price?: number;
  wholesale_price?: number;
  quantity?: number;
  brand?: string;
  category?: string;
  tax?: string;
  images?: PrestaShopProductImage[];
  is_new?: boolean;
  is_updated?: boolean;
  // Present when the row comes from the PrestaShop Webservice: the raw id of
  // the product resource, used to push user edits back to the shop.
  prestashop_id?: string;
}

// An image associated with a PrestaShop product. `url` is a relative path on
// the Catalog AI backend that proxies the binary from the PrestaShop Webservice
// (so the shop's API key never reaches the browser).
export interface PrestaShopProductImage {
  id: string;
  product_id: string;
  url: string;
}

export type AIContentField =
  | 'name' | 'description_short' | 'description'
  | 'meta_title' | 'meta_description' | 'link_rewrite';

export type AIProviderName = 'openai' | 'anthropic' | 'openrouter' | 'mock';

// Credentials and options stored per AI provider. Each provider keeps its own
// saved settings so switching the active provider never loses a previously
// configured key, model, language or endpoint.
export interface AIProviderSettings {
  model?: string;
  api_key?: string;
  language?: string;
  // Overrides the default endpoint of the provider. When unset, the provider's
  // well-known base URL (see AI_PROVIDER_DEFAULT_URLS) is used.
  base_url?: string;
}

export interface AIConfig {
  // The provider currently in use: its stored settings are the ones the AI
  // suggesters use. The settings of the other providers stay saved and are
  // restored whenever the user selects them again.
  provider: AIProviderName;
  // Settings stored for every provider the user has configured, so switching
  // providers never loses a previously saved key, model, language or endpoint.
  providers?: Partial<Record<AIProviderName, AIProviderSettings>>;
  // Effective settings of the active provider (mirror of providers[provider]).
  // Kept flat for the AI suggesters and for compatibility with older configs.
  model?: string;
  api_key?: string;
  language?: string;
  // Overrides the default endpoint of the active provider. When unset, the
  // provider's well-known base URL (see AI_PROVIDER_DEFAULT_URLS) is used.
  base_url?: string;
  enabled_fields: AIContentField[];
  max_requests_per_minute?: number;
  temperature?: number;
  // Custom prompt used to ask an AI to propose product field values. When empty
  // or unset, the system default prompt (DEFAULT_AI_PROMPTS) is used.
  default_prompt?: string;
}

export interface AIRequest {
  field: AIContentField;
  product: ProductData;
  context: string;
  language: string;
  max_length: number;
  style: {
    tone: string;
    audience: string;
    seo_friendly: boolean;
    include_features: boolean;
  };
}

export interface AIResponse {
  original_field: AIContentField;
  suggested_value: string;
  confidence: number;
  improvements: string[];
  seo_notes: any;
  warnings: string[];
}

export type ProductId = string;
export type EAN = string;
export type Reference = string;

export interface PrestaShopConfig {
  base_url: string;
  api_key: string;
  version: string;
  language_id: number;
  timeout?: number;
}

export interface PrestaShopStockAvailable {
  id?: string;
  id_product?: ProductId;
  quantity?: number;
  reference?: Reference;
}

// Combination-level data fetched from the PrestaShop Webservice (used by the
// client; the fetcher imports products only, so imported rows never expand
// combinations).
export interface PrestaShopCombinationInfo {
  id_product_attribute: string;
  id_product: string;
  reference?: string;
  ean13?: string;
  price?: number;
  wholesale_price?: number;
  stock_available_id?: string;
  quantity?: number;
}

// Product-level data fetched from PrestaShop (shared by all combinations of the
// same id_product).
export interface PrestaShopProductInfo {
  id: string;
  reference?: string;
  ean13?: string;
  name?: string;
  description?: string;
  description_short?: string;
  meta_title?: string;
  meta_description?: string;
  tax_rules_group_id?: number;
  price?: number;
  wholesale_price?: number;
  manufacturer_id?: string;
  categories?: string[];
  // Present when the product resource was fetched with `display=full`.
  combination_ids?: string[];
  image_ids?: string[];
  image_count?: number;
}

export interface PrestaShopAPIEndpoints {
  root: string;
  products: string;
  combinations: string;
  stock_availables: string;
  manufacturers: string;
  categories: string;
  images: string;
}

// The subset of product fields the frontend can overwrite and push back to
// PrestaShop. Only the fields present in an update are sent to the shop.
export interface PrestaShopProductUpdate {
  description_short?: string;
  description?: string;
  meta_title?: string;
  meta_description?: string;
}
