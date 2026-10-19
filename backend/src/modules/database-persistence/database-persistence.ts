// Database-backed configuration persistence, scoped by comercio_id.
// Replaces ConfigPersistence (file + AES encryption) with SQLite storage.
//
// The PrestaShop credentials and the prompt stay per comercio; the AI provider
// configuration is global (see modules/ai-config) and is never saved from here.

import {
  getMarketplaceConfig,
  setMarketplaceConfigBatch,
  getAppSetting,
  setAppSetting,
  deleteAppSetting,
  findMarketplaceByName
} from '../auth/database';
import { loadGlobalAIConfig } from '../ai-config/global-ai';
import { AIContentField } from '../../types';
import { CatalogConfig } from '../../store';

function parseJSON<T>(raw: string | undefined, fallback: T): T {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

export class DatabasePersistence {
  constructor(private readonly comercioId: number) {}

  load(): CatalogConfig | null {
    const activeMarketplaceName = getAppSetting(this.comercioId, 'active_marketplace') || 'PrestaShop';

    const mp = findMarketplaceByName(activeMarketplaceName, this.comercioId);
    const psConfig = mp ? getMarketplaceConfig(mp.id, this.comercioId) : {};
    const prestashop = {
      base_url: psConfig.base_url || '',
      api_key: psConfig.api_key || '',
      version: psConfig.version || '1.7',
      language_id: Number(psConfig.language_id) || 1,
      ...(psConfig.timeout ? { timeout: Number(psConfig.timeout) } : {})
    };

    // The AI provider configuration is global and shared by every comercio; only
    // the prompt and the enabled fields are customized per comercio.
    const ai = loadGlobalAIConfig();
    const enabledFields = parseJSON<AIContentField[]>(getAppSetting(this.comercioId, 'enabled_fields'), ['name', 'description'] as AIContentField[]);
    const defaultPrompt = getAppSetting(this.comercioId, 'default_prompt') || undefined;

    return {
      prestashop,
      ai: {
        ...ai,
        enabled_fields: enabledFields,
        ...(defaultPrompt ? { default_prompt: defaultPrompt } : {})
      }
    };
  }

  save(config: CatalogConfig): void {
    const activeMarketplaceName = getAppSetting(this.comercioId, 'active_marketplace') || 'PrestaShop';
    const mp = findMarketplaceByName(activeMarketplaceName, this.comercioId);
    if (mp) {
      setMarketplaceConfigBatch(mp.id, this.comercioId, {
        base_url: config.prestashop.base_url || '',
        api_key: config.prestashop.api_key || '',
        version: config.prestashop.version || '1.7',
        language_id: String(config.prestashop.language_id || 1),
        ...(config.prestashop.timeout ? { timeout: String(config.prestashop.timeout) } : {})
      });
    }

    // Only the per-comercio AI settings are saved here: the provider, its API
    // key, model, endpoint and the active provider are global (super admin
    // territory) and are never written from a comercio's config.
    setAppSetting(this.comercioId, 'enabled_fields', JSON.stringify(config.ai.enabled_fields || []));
    if (config.ai.default_prompt !== undefined && config.ai.default_prompt !== '') {
      setAppSetting(this.comercioId, 'default_prompt', config.ai.default_prompt);
    } else {
      // An empty/absent prompt means "use the system default", so any previously
      // stored custom prompt is removed (this is what reset-prompt relies on).
      deleteAppSetting(this.comercioId, 'default_prompt');
    }
  }
}
