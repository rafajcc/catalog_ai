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
  price?: number;
  wholesale_price?: number;
  quantity?: number;
  brand?: string;
  category?: string;
  tax?: string;
  is_new?: boolean;
  is_updated?: boolean;
}

export type AIContentField =
  | 'name' | 'description_short' | 'description'
  | 'meta_title' | 'meta_description' | 'link_rewrite';

export type AIProviderName = 'openai' | 'anthropic' | 'openrouter' | 'mock';

export interface AIConfig {
  provider: AIProviderName;
  model?: string;
  api_key?: string;
  language?: string;
  enabled_fields: AIContentField[];
  max_requests_per_minute?: number;
  temperature?: number;
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

// One imported row is one product combination in PrestaShop. Resolving a row
// means matching its EAN to a `ps_product_attribute` (id_product_attribute)
// and, from there, to its parent product (id_product).
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
  tax_rules_group_id?: number;
  price?: number;
  wholesale_price?: number;
  manufacturer_id?: string;
  categories?: string[];
  // Present when the product resource was fetched with `display=full`.
  combination_ids?: string[];
  image_count?: number;
}

export interface PrestaShopAPIEndpoints {
  root: string;
  products: string;
  combinations: string;
  stock_availables: string;
  manufacturers: string;
  categories: string;
}
