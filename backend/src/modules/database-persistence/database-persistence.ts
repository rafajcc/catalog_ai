// Database-backed configuration persistence, scoped by comercio_id.
// Replaces ConfigPersistence (file + AES encryption) with SQLite storage.

import {
  getMarketplaceConfig,
  setMarketplaceConfigBatch,
  getAIProviderConfig,
  setAIProviderConfigBatch,
  getAppSetting,
  setAppSetting
} from '../auth/database';
import { AIContentField, AIProviderName, AIProviderSettings } from '../../types';
import { CatalogConfig } from '../../store';

function parseJSON<T>(raw: string | undefined, fallback: T): T {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

export class DatabasePersistence {
  constructor(private readonly comercioId: number) {}

  load(): CatalogConfig | null {
    const activeMarketplace = getAppSetting(this.comercioId, 'active_marketplace') || 'prestashop';
    const activeAIProvider = getAppSetting(this.comercioId, 'active_ai_provider') || 'mock';

    const psConfig = getMarketplaceConfig(activeMarketplace, this.comercioId);
    const prestashop = {
      base_url: psConfig.base_url || '',
      api_key: psConfig.api_key || '',
      version: psConfig.version || '1.7',
      language_id: Number(psConfig.language_id) || 1,
      ...(psConfig.timeout ? { timeout: Number(psConfig.timeout) } : {})
    };

    const providerNames: AIProviderName[] = ['mock', 'openai', 'anthropic', 'gpt4all'];
    const providers: Partial<Record<AIProviderName, AIProviderSettings>> = {};
    for (const name of providerNames) {
      const cfg = getAIProviderConfig(name, this.comercioId);
      if (Object.keys(cfg).length === 0) continue;
      providers[name] = {};
      if (cfg.model) providers[name]!.model = cfg.model;
      if (cfg.api_key) providers[name]!.api_key = cfg.api_key;
      if (cfg.language) providers[name]!.language = cfg.language;
      if (cfg.base_url) providers[name]!.base_url = cfg.base_url;
      if (cfg.temperature) providers[name]!.temperature = Number(cfg.temperature);
    }

    const enabledFields = parseJSON<AIContentField[]>(getAppSetting(this.comercioId, 'enabled_fields'), ['name', 'description'] as AIContentField[]);
    const defaultPrompt = getAppSetting(this.comercioId, 'default_prompt') || undefined;
    const maxRPM = getAppSetting(this.comercioId, 'max_requests_per_minute');

    const active = providers[activeAIProvider as AIProviderName] ?? {};

    return {
      prestashop,
      ai: {
        provider: activeAIProvider as AIProviderName,
        providers,
        model: active.model,
        api_key: active.api_key,
        language: active.language,
        base_url: active.base_url,
        enabled_fields: enabledFields,
        ...(maxRPM ? { max_requests_per_minute: Number(maxRPM) } : {}),
        ...(active.temperature !== undefined ? { temperature: active.temperature } : {}),
        ...(defaultPrompt ? { default_prompt: defaultPrompt } : {})
      }
    };
  }

  save(config: CatalogConfig): void {
    const activeMarketplace = getAppSetting(this.comercioId, 'active_marketplace') || 'prestashop';

    setMarketplaceConfigBatch(activeMarketplace, this.comercioId, {
      base_url: config.prestashop.base_url || '',
      api_key: config.prestashop.api_key || '',
      version: config.prestashop.version || '1.7',
      language_id: String(config.prestashop.language_id || 1),
      ...(config.prestashop.timeout ? { timeout: String(config.prestashop.timeout) } : {})
    });

    const providerNames: AIProviderName[] = ['mock', 'openai', 'anthropic', 'gpt4all'];
    for (const name of providerNames) {
      const settings = config.ai.providers?.[name];
      if (!settings) continue;
      const batch: Record<string, string> = {};
      if (settings.model !== undefined) batch.model = settings.model;
      if (settings.api_key !== undefined) batch.api_key = settings.api_key;
      if (settings.language !== undefined) batch.language = settings.language;
      if (settings.base_url !== undefined) batch.base_url = settings.base_url;
      if (settings.temperature !== undefined) batch.temperature = String(settings.temperature);
      if (Object.keys(batch).length > 0) {
        setAIProviderConfigBatch(name, this.comercioId, batch);
      }
    }

    setAppSetting(this.comercioId, 'active_ai_provider', config.ai.provider);
    setAppSetting(this.comercioId, 'enabled_fields', JSON.stringify(config.ai.enabled_fields || []));
    if (config.ai.default_prompt !== undefined) {
      setAppSetting(this.comercioId, 'default_prompt', config.ai.default_prompt);
    }
    if (config.ai.max_requests_per_minute !== undefined) {
      setAppSetting(this.comercioId, 'max_requests_per_minute', String(config.ai.max_requests_per_minute));
    }
  }
}
