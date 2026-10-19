import { AppError } from '../../../utils/error-handler';
import { CatalogConfig, DataStore, SHOPIFY_DEFAULT_API_VERSION } from '../../../store';
import { PrestaShopConfig, ShopifyConfig } from '../../../types';
import { createPrestashopAdapter } from './prestashop-adapter';
import { createShopifyAdapter } from './shopify-adapter';
import { createMockAdapter } from './mock-adapter';
import { MarketplaceAdapter, RegisteredMarketplace } from './types';

export interface MarketplaceLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

// Test-only hook to substitute the HTTP transport of a marketplace. Keyed by
// the registered marketplace so this contract never names a concrete client
// class: each adapter narrows its own slot, and adding a marketplace does not
// touch this file. The factory takes `never` so any real config type assigns,
// and only the owning adapter ever calls it.
export type MarketplaceClientFactory = (config: never) => unknown;
export type MarketplaceClientFactories = Partial<Record<RegisteredMarketplace, MarketplaceClientFactory>>;

// Everything an adapter may need that the composition root decides. In
// production `clientFactories` stays undefined and each adapter builds its
// real client; the factories exist so tests can substitute the transport.
export interface MarketplaceCreateContext {
  logger?: MarketplaceLogger;
  clientFactories?: MarketplaceClientFactories;
}

// Resolves a registered marketplace against the saved config into a ready
// adapter. Injected into the routes so the core never builds one directly.
export type MarketplaceResolver = (
  name: RegisteredMarketplace,
  config: CatalogConfig,
  store: DataStore
) => MarketplaceAdapter;

// Builds an adapter for a CANDIDATE config sent in a request body (used by the
// connection-test endpoint), returning the human label for the success message.
export type MarketplaceTestAdapterFactory = (
  name: RegisteredMarketplace,
  body: Record<string, unknown>,
  config: CatalogConfig,
  store: DataStore
) => { adapter: MarketplaceAdapter; label: string };

// Everything the core needs to know about one marketplace, without importing
// its concrete adapter. Adding a marketplace = one new entry here plus its
// adapter file; no route, store or frontend change is required for the fetch
// flow. This record is the ONLY place that branches per marketplace.
interface MarketplaceDefinition {
  name: RegisteredMarketplace;
  // Lowercase URL segment used by /fetch/:marketplace and /config/test/:marketplace.
  slug: string;
  // Human label used in user-facing messages.
  label: string;
  extractConfig(config: CatalogConfig): unknown;
  isConfigured(config: CatalogConfig): boolean;
  // Builds the config to test a connection from a request body, falling back to
  // the saved credentials for fields the body leaves empty. Throws AppError when
  // a required field is missing.
  buildTestConfig(body: Record<string, unknown>, saved: unknown): unknown;
  create(config: unknown, store: DataStore, ctx: MarketplaceCreateContext): MarketplaceAdapter;
}

const definitions: Record<RegisteredMarketplace, MarketplaceDefinition> = {
  PrestaShop: {
    name: 'PrestaShop',
    slug: 'prestashop',
    label: 'PrestaShop',
    extractConfig: (config) => config.prestashop,
    isConfigured: (config) => Boolean(config.prestashop?.base_url && config.prestashop?.api_key),
    buildTestConfig: (body, saved) => {
      const previous = saved as PrestaShopConfig | undefined;
      const candidate: PrestaShopConfig = {
        base_url: typeof body.base_url === 'string' ? body.base_url : '',
        api_key: (typeof body.api_key === 'string' && body.api_key) || previous?.api_key || '',
        version: typeof body.version === 'string' ? body.version : '1.7',
        language_id: typeof body.language_id === 'number' ? body.language_id : 1
      };
      if (!candidate.base_url) throw new AppError('La URL base de PrestaShop es obligatoria', 400);
      if (!candidate.api_key) throw new AppError('La API key de PrestaShop es obligatoria', 400);
      return candidate;
    },
    create: (config, store, ctx) => createPrestashopAdapter(config as PrestaShopConfig, store, ctx)
  },
  Shopify: {
    name: 'Shopify',
    slug: 'shopify',
    label: 'Shopify',
    extractConfig: (config) => config.shopify,
    isConfigured: (config) => Boolean(config.shopify?.shop_domain && config.shopify?.access_token),
    buildTestConfig: (body, saved) => {
      const previous = saved as ShopifyConfig | undefined;
      const candidate: ShopifyConfig = {
        shop_domain: typeof body.shop_domain === 'string' ? body.shop_domain : '',
        access_token: (typeof body.access_token === 'string' && body.access_token) || previous?.access_token || '',
        api_version:
          (typeof body.api_version === 'string' && body.api_version) ||
          previous?.api_version ||
          SHOPIFY_DEFAULT_API_VERSION,
        timeout: typeof body.timeout === 'number' ? body.timeout : previous?.timeout
      };
      if (!candidate.shop_domain) throw new AppError('El dominio de Shopify es obligatorio', 400);
      if (!candidate.access_token) throw new AppError('El token de acceso de Shopify es obligatorio', 400);
      return candidate;
    },
    create: (config, store, ctx) => createShopifyAdapter(config as ShopifyConfig, store, ctx)
  },
  Mock: {
    name: 'Mock',
    slug: 'mock',
    label: 'Mock',
    extractConfig: () => ({}),
    isConfigured: () => true,
    buildTestConfig: () => ({}),
    create: (_config, store) => createMockAdapter(store)
  }
};

const bySlug = new Map<string, RegisteredMarketplace>(
  Object.values(definitions).map((def) => [def.slug, def.name])
);

// Maps the lowercase `:marketplace` URL segment to a registered marketplace.
export function parseMarketplaceSlug(slug: string): RegisteredMarketplace | undefined {
  return bySlug.get(String(slug ?? '').toLowerCase());
}

export function getMarketplaceLabel(name: RegisteredMarketplace): string {
  return definitions[name]?.label ?? name;
}

// Whether the saved config for this marketplace holds the credentials it needs.
export function isMarketplaceConfigured(name: RegisteredMarketplace, config: CatalogConfig): boolean {
  const def = definitions[name];
  return def ? def.isConfigured(config) : false;
}

// Whether a value names a marketplace known to the registry, so request bodies
// (like the active marketplace) can be validated without hardcoding names.
export function isRegisteredMarketplace(value: unknown): value is RegisteredMarketplace {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(definitions, value);
}

// Resolves a marketplace against the SAVED config into a ready adapter. The
// only per-marketplace dispatch point in the whole application.
export function resolveMarketplace(
  name: RegisteredMarketplace,
  config: CatalogConfig,
  store: DataStore,
  ctx: MarketplaceCreateContext = {}
): MarketplaceAdapter {
  const def = definitions[name];
  if (!def) throw new AppError(`Marketplace desconocido: ${name}`, 400);
  return def.create(def.extractConfig(config), store, ctx);
}

// Builds an adapter for a CANDIDATE config assembled from the request body and
// the saved credentials, for the connection-test endpoint.
export function createTestAdapter(
  name: RegisteredMarketplace,
  body: Record<string, unknown>,
  config: CatalogConfig,
  store: DataStore,
  ctx: MarketplaceCreateContext = {}
): { adapter: MarketplaceAdapter; label: string } {
  const def = definitions[name];
  if (!def) throw new AppError(`Marketplace desconocido: ${name}`, 400);
  const candidate = def.buildTestConfig(body, def.extractConfig(config));
  return { adapter: def.create(candidate, store, ctx), label: def.label };
}
