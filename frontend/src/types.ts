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
  // The provider currently in use (global, resolved by the backend from the
  // super admin's active provider): its settings are the ones used.
  provider: AIProviderName;
  // Effective settings of the active provider, resolved globally by the backend.
  model?: string;
  api_key?: string;
  language?: string;
  // Effective endpoint of the active provider; read-only on the UI.
  base_url?: string;
  enabled_fields: AIContentField[];
  temperature?: number;
  // Request timeout in seconds of the active provider. Empty means 30s default.
  timeout?: number;
  // How many autocomplete calls run at the same time for the active provider.
  // Empty means the default of 5 concurrent calls.
  concurrency?: number;
  // Web search setting of the active OpenAI provider.
  web_search?: boolean;
  // Custom prompt used to ask an AI to propose product field values. When empty
  // or unset, the system default prompt is used.
  default_prompt?: string;
}

// Supported e-commerce platforms. The user picks which one is active and the
// dashboard, upload and product views follow that choice. `Mock` is the canned
// demo marketplace (no credentials) used to try the whole flow.
export type MarketplaceName = 'PrestaShop' | 'Shopify' | 'Mock';

export interface PrestaShopConfig {
  base_url: string;
  api_key: string;
  version: string;
  language_id: number;
  timeout?: number;
  has_api_key?: boolean;
  // Masked preview of the stored key (first and last characters) returned by
  // GET /config; the real value never reaches the browser.
  api_key_hint?: string | null;
}

// Credentials for a Shopify custom app: the shop domain (e.g.
// "mi-tienda.myshopify.com") and an Admin API access token. The token is masked
// by GET /config and never reaches the browser; product images are proxied by
// the backend.
export interface ShopifyConfig {
  shop_domain: string;
  access_token: string;
  api_version: string;
  timeout?: number;
  has_api_key?: boolean;
  // Masked preview of the stored token (first and last characters) returned by
  // GET /config; the real value never reaches the browser.
  api_key_hint?: string | null;
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

// Shopify Admin API fetch criteria. Same shape as PrestaShop so the upload UI
// can reuse the same controls for both marketplaces.
export type ShopifyPresenceFilter = PrestaShopPresenceFilter;
export type ShopifyFilterOperator = PrestaShopFilterOperator;
export type ShopifyFetchRequest = PrestaShopFetchRequest;

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

// An image associated with a Shopify product. `url` is a backend-relative path
// that proxies the binary through the Admin API/Cdn, so the access token never
// reaches the browser.
export type ShopifyProductImage = PrestaShopProductImage;

// One imported product row as returned by the fetch endpoints. `prestashop_id`
// or `shopify_id` carries the raw id of the source platform, used when pushing
// edits back to the shop.
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
  // The raw Shopify product id (e.g. "gid://shopify/Product/123"), used when
  // pushing edits back to the shop.
  shopify_id?: string;
}

// In-memory user edits applied on top of the imported products, keyed by
// product id. Only the text fields the user can overwrite in the product
// editor are stored; when saved to PrestaShop, only these fields are sent.
export interface ProductImageUpload {
  data: string;        // base64-encoded image bytes
  content_type: string; // e.g. "image/jpeg"
}

export interface ProductEdits {
  description_short?: string;
  description?: string;
  meta_title?: string;
  meta_description?: string;
  image_urls?: string[];
  local_images?: ProductImageUpload[];
  images_to_delete?: string[];
}

export type ProductEditsMap = Record<string, ProductEdits>;

// Result of one AI autocomplete call for a product: the reference plus the
// proposed values for the fields the AI could fill. Only the non-empty proposals
// come back, and the grid applies them only to the fields that are still empty.
export interface AiAutocompleteResult {
  reference?: string;
  status?: string;
  confidence?: number | null;
  warnings?: string[];
  proposals?: Partial<Record<AIContentField, string>>;
  // Set when the AI provider could not generate the proposals; the image
  // search may still have succeeded and image_urls may still be present.
  ai_error?: string | null;
  image_urls?: string[];
}

// API response envelopes
export type ApiUserRole = 'admin' | 'user' | 'superadmin';

export interface ApiUser {
  id: number;
  username: string;
  role: ApiUserRole;
  comercio_id: number;
  comercio_name?: string;
  prestashop_configured?: boolean;
  shopify_configured?: boolean;
  ai_configured?: boolean;
  // Which marketplace the comercio is currently working with.
  active_marketplace?: MarketplaceName;
  // True when the password was chosen by an admin/super admin, so the user
  // must change it before using the platform.
  must_change_password?: boolean;
  // False when the account was deactivated by the comercio admin or the super
  // admin; a disabled user cannot log in and its sessions are killed.
  active?: boolean;
  created_at?: string;
  updated_at?: string;
}

// One comercio as seen by the super admin.
export interface ApiComercio {
  id: number;
  name: string;
  active: boolean;
  user_count: number;
  created_at?: string;
  updated_at?: string;
}

// A single-use invitation code the super admin mints and hands out so that a
// new comercio can register. The API sends active/used as numbers (1/0); the UI
// treats them as flags and only shows a code as usable when it is active, not
// used and not expired.
export interface ApiRegistrationNonce {
  id: number;
  code: string;
  expires_at: string;
  active: number;
  used: number;
  used_by_comercio_id?: number | null;
  used_by_comercio_name?: string | null;
  created_by?: string | null;
  created_at?: string;
  updated_at?: string;
}

// Image provider services managed by the super admin. Credential values are
// never exposed by the API, only the has_* flags so the UI can show who is
// configured; the config modal lets the admin fill or clear each field.
export type ImageProviderAuthKind = 'api_key' | 'user_password' | 'none';

export interface ApiImageProviderConfigField {
  key: string;
  label: string;
  configured: boolean;
}

export interface ApiImageProvider {
  id: number;
  slug: string;
  name: string;
  enabled: boolean;
  sort_order: number;
  implemented: boolean;
  always_first: boolean;
  auth_kind: ImageProviderAuthKind;
  has_api_key: boolean;
  has_username: boolean;
  has_password: boolean;
  max_calls_per_month: string | null;
  extra_config: ApiImageProviderConfigField[];
  calls_this_cycle: number;
  billing_cycle_day: number | null;
  cycle_start: string | null;
  last_called: boolean;
}

// One row of the super admin provider feed table (brand/reference/ean -> URL).
export interface ApiProviderFeedImage {
  id: number;
  brand: string;
  reference: string | null;
  ean: string | null;
  image_url: string;
  created_at?: string;
}

// AI provider as managed by the super admin. The provider configuration is
// global (shared by every comercio) and only the super admin can change it. The
// API never exposes the stored API key, only the `has_api_key` flag and a
// masked `api_key_hint` (first/last characters) so the admin can recognise it.
  export interface ApiAiProviderCapabilities {
    web_search?: boolean;
  }

  export interface ApiAiProvider {
    name: AIProviderName;
    label: string;
    enabled: boolean;
    is_active: boolean;
    has_api_key: boolean;
    api_key_hint?: string | null;
    configured: boolean;
    model?: string;
    base_url?: string;
    language?: string;
    timeout?: number | null;
    concurrency?: number | null;
    web_search?: boolean;
    capabilities?: ApiAiProviderCapabilities;
  }

// Editable fields of a global AI provider. `api_key: null` clears the stored
// key; an empty string or undefined leaves it untouched.
export interface AiProviderUpdate {
  provider?: AIProviderName;
  enabled?: boolean;
  model?: string;
  base_url?: string;
  language?: string;
  timeout?: number | null;
  concurrency?: number | null;
  web_search?: boolean;
  api_key?: string | null;
}

// Per-comercio quota for AI autocomplete.
export interface ApiAutocompleteQuota {  comercio_id: number;
  comercio_name: string;
  monthly_limit: number;
  unlimited: boolean;
  billing_cycle_day: number;
  calls_this_cycle: number;
  remaining: number | null;
  cycle_start: string | null;
  updated_at?: string;
}

// Audit log row as returned by the super admin quota report.
export interface ApiAutocompleteAuditLogRow {
  id: number;
  comercio_id: number;
  comercio_name: string | null;
  user_id: number;
  user_name: string | null;
  ai_provider_id: number | null;
  ai_provider_name: string | null;
  status: string | null;
  product_brand: string | null;
  product_reference: string | null;
  product_ean: string | null;
  requested_at: string;
}

// On-screen report: the newest rows of the range plus how many calls the whole
// range contains, so the table can say when it is not showing all of them.
export interface ApiAutocompleteAuditLogResponse {
  success: boolean;
  data: {
    rows: ApiAutocompleteAuditLogRow[];
    total: number;
    limit: number;
  };
}

// M2M API key of a comercio (used by the PrestaShop module / the Shopify app to
// call the public API). The API never returns the secret except once, at
// creation time, so the UI can only ever show the identifying prefix afterwards.
export interface ApiComercioApiKey {
  id: number;
  comercio_id: number;
  name: string;
  key_prefix: string;
  active: boolean;
  revoked: boolean;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface ApiResponse {
  success: boolean;
  message?: string;
  version?: string;
  data?: any;
  error?: string;
  comercios?: ApiComercio[];
  comercio?: ApiComercio;
  user?: ApiUser;
  users?: ApiUser[];
  nonces?: ApiRegistrationNonce[];
  nonce?: ApiRegistrationNonce;
}

export interface ConfigurationResponse extends ApiResponse {
  prestashop?: PrestaShopConfig;
  shopify?: ShopifyConfig;
  ai?: AIConfig;
  active_marketplace?: MarketplaceName;
}
