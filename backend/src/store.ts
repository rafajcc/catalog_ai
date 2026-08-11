// In-memory data store for the Catalog AI API.
// State is scoped to a single app instance so every createApp() call starts clean.

import { nanoid } from 'nanoid';
import { AIConfig, AIProviderName, AIProviderSettings, PrestaShopConfig, ProductData } from './types';

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

  const active = providers[ai.provider ?? 'mock'] ?? {};
  return {
    provider: ai.provider ?? 'mock',
    providers,
    model: active.model,
    api_key: active.api_key,
    language: active.language,
    base_url: active.base_url,
    enabled_fields: ai.enabled_fields ?? ['name', 'description'],
    max_requests_per_minute: ai.max_requests_per_minute,
    temperature: ai.temperature,
    default_prompt: ai.default_prompt
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
