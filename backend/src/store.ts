// In-memory data store for the Catalog AI API.
// State is scoped to a single app instance so every createApp() call starts clean.

import { nanoid } from 'nanoid';
import { AIConfig, AIProviderName, AIProviderSettings, MarketplaceName, PrestaShopConfig, ShopifyConfig, ProductData } from './types';

// Default Shopify Admin API version used when a comercio does not set one.
// Shopify publishes a new stable version every quarter (format YYYY-MM).
export const SHOPIFY_DEFAULT_API_VERSION = '2026-07';

export interface DataSet {
  dataId: string;
  fileId: string;
  fileName: string;
  products: ProductData[];
  totalRows: number;
}

export interface CatalogConfig {
  // The shop the fetch/save flow talks to. Both marketplace configs are kept
  // so the settings screen can configure and test either one.
  active_marketplace: MarketplaceName;
  prestashop: PrestaShopConfig;
  shopify: ShopifyConfig;
  ai: AIConfig;
}

function defaultConfig(): CatalogConfig {
  return {
    active_marketplace: 'PrestaShop',
    prestashop: { base_url: '', api_key: '', version: '1.7', language_id: 1 },
    shopify: { shop_domain: '', access_token: '', api_version: SHOPIFY_DEFAULT_API_VERSION },
    ai: {
      provider: 'mock',
      providers: { mock: {} },
      enabled_fields: ['name', 'description']
    }
  };
}

// Normalizes a persisted AI config into the per-provider shape. Older config
// files stored the settings of the active provider flat (model, api_key,
// language, base_url next to the provider field); those are folded into the
// `providers` map of that provider so no previously saved setting is lost. The
// returned config also mirrors the active provider's settings flat, which is
// what the AI suggesters consume.
export function normalizeAIConfig(ai?: Partial<AIConfig>): AIConfig {
  const fallback: AIConfig = {
    provider: 'mock',
    providers: { mock: {} },
    enabled_fields: ['name', 'description']
  };
  if (!ai) return fallback;

  const legacy = ai as unknown as {
    model?: string;
    api_key?: string;
    language?: string;
    base_url?: string;
  };
  const hasLegacy =
    legacy.model !== undefined ||
    legacy.api_key !== undefined ||
    legacy.language !== undefined ||
    legacy.base_url !== undefined;

  const providers: Partial<Record<AIProviderName, AIProviderSettings>> = { ...(ai.providers ?? {}) };
  if (hasLegacy) {
    const provider = ai.provider ?? 'mock';
    const settings: AIProviderSettings = { ...(providers[provider] ?? {}) };
    if (legacy.model !== undefined) settings.model = legacy.model;
    if (legacy.api_key !== undefined) settings.api_key = legacy.api_key;
    if (legacy.language !== undefined) settings.language = legacy.language;
    if (legacy.base_url !== undefined) settings.base_url = legacy.base_url;
    providers[provider] = settings;
  }

  // Web search is on by default for OpenAI: the autocomplete prompts rely on
  // the model consulting the web. Only an explicit `false` turns the tool off.
  if (!providers.openai) providers.openai = {};
  if (providers.openai.web_search === undefined) providers.openai.web_search = true;

  const active = providers[ai.provider ?? 'mock'] ?? {};
  return {
    provider: ai.provider ?? 'mock',
    providers,
    model: active.model,
    api_key: active.api_key,
    language: active.language,
    base_url: active.base_url,
    concurrency: active.concurrency,
    web_search: active.web_search,
    enabled_fields: ai.enabled_fields ?? ['name', 'description'],
    max_requests_per_minute: ai.max_requests_per_minute,
    temperature: ai.temperature,
    timeout: ai.timeout,
    default_prompt: ai.default_prompt
  };
}

export class DataStore {
  // Working dataset fetched from the PrestaShop Webservice.
  prestashopDataset: DataSet | undefined = undefined;
  // Working dataset fetched from the Shopify Admin API.
  shopifyDataset: DataSet | undefined = undefined;
  config: CatalogConfig = defaultConfig();

  newId(prefix = 'data'): string {
    return `${prefix}_${nanoid(8)}`;
  }
}
