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
import { AIContentField, MarketplaceName } from '../../types';
import { CatalogConfig, SHOPIFY_DEFAULT_API_VERSION } from '../../store';

function parseJSON<T>(raw: string | undefined, fallback: T): T {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

export class DatabasePersistence {
  constructor(private readonly comercioId: number) {}

  load(): CatalogConfig | null {
    const activeMarketplaceName = (getAppSetting(this.comercioId, 'active_marketplace') || 'PrestaShop') as MarketplaceName;

    const psMp = findMarketplaceByName('PrestaShop', this.comercioId);
    const psConfig = psMp ? getMarketplaceConfig(psMp.id, this.comercioId) : {};
    const prestashop = {
      base_url: psConfig.base_url || '',
      api_key: psConfig.api_key || '',
      version: psConfig.version || '1.7',
      language_id: Number(psConfig.language_id) || 1,
      ...(psConfig.timeout ? { timeout: Number(psConfig.timeout) } : {})
    };

    // The Shopify config lives in its own marketplace row, independent of the
    // active marketplace, so both sections of the settings screen can be shown
    // at the same time.
    const shopifyMp = findMarketplaceByName('Shopify', this.comercioId);
    const shopifyConfig = shopifyMp ? getMarketplaceConfig(shopifyMp.id, this.comercioId) : {};
    const shopify = {
      shop_domain: shopifyConfig.shop_domain || '',
      access_token: shopifyConfig.access_token || '',
      api_version: shopifyConfig.api_version || SHOPIFY_DEFAULT_API_VERSION,
      ...(shopifyConfig.timeout ? { timeout: Number(shopifyConfig.timeout) } : {})
    };

    // The AI provider configuration is global and shared by every comercio; only
    // the prompt and the enabled fields are customized per comercio.
    const ai = loadGlobalAIConfig();
    const enabledFields = parseJSON<AIContentField[]>(getAppSetting(this.comercioId, 'enabled_fields'), ['name', 'description'] as AIContentField[]);
    const defaultPrompt = getAppSetting(this.comercioId, 'default_prompt') || undefined;

    return {
      active_marketplace: activeMarketplaceName,
      prestashop,
      shopify,
      ai: {
        ...ai,
        enabled_fields: enabledFields,
        ...(defaultPrompt ? { default_prompt: defaultPrompt } : {})
      }
    };
  }

  save(config: CatalogConfig): void {
    const activeMarketplaceName = config.active_marketplace || 'PrestaShop';
    const psMp = findMarketplaceByName('PrestaShop', this.comercioId);
    if (psMp) {
      setMarketplaceConfigBatch(psMp.id, this.comercioId, {
        base_url: config.prestashop.base_url || '',
        api_key: config.prestashop.api_key || '',
        version: config.prestashop.version || '1.7',
        language_id: String(config.prestashop.language_id || 1),
        ...(config.prestashop.timeout ? { timeout: String(config.prestashop.timeout) } : {})
      });
    }

    const shopifyMp = findMarketplaceByName('Shopify', this.comercioId);
    if (shopifyMp) {
      setMarketplaceConfigBatch(shopifyMp.id, this.comercioId, {
        shop_domain: config.shopify.shop_domain || '',
        access_token: config.shopify.access_token || '',
        api_version: config.shopify.api_version || SHOPIFY_DEFAULT_API_VERSION,
        ...(config.shopify.timeout ? { timeout: String(config.shopify.timeout) } : {})
      });
    }

    if (config.active_marketplace) {
      setAppSetting(this.comercioId, 'active_marketplace', config.active_marketplace);
    } else if (activeMarketplaceName) {
      setAppSetting(this.comercioId, 'active_marketplace', activeMarketplaceName);
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
