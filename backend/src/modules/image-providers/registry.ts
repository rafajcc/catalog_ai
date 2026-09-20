// Registry of every image provider service. Adding a service is: write its
// class in providers/, instantiate it here, and the super admin panel, the
// database seeding and the round-robin engine pick it up automatically.
//
// The two brand crawlers of the user request (Playwright and plain HTML) are
// listed but NOT implemented yet: they stay visible in the super admin list
// marked as non-implemented so the entry point (and the config slot) already
// exists for when they get ported.

import { ImageProvider, ImageProviderDefinition, ProviderError } from './types';
import { upsertImageProvider } from '../auth/database';
import { ApifyImageProvider } from './providers/apify';
import { BarcodeLookupImageProvider } from './providers/barcodelookup';
import { BraveImageProvider } from './providers/brave';
import { BrightDataImageProvider } from './providers/brightdata';
import { DataForSEOImageProvider } from './providers/dataforseo';
import { DecodoImageProvider } from './providers/decodo';
import { DdgsImageProvider } from './providers/ddgs';
import { ExaImageProvider } from './providers/exa';
import { FeedsImageProvider } from './providers/feeds';
import { FirecrawlImageProvider } from './providers/firecrawl';
import { MockImageProvider } from './providers/mock';
import { NexscopeImageProvider } from './providers/nexscope';
import { OpenSerpImageProvider } from './providers/openserp';
import { OxylabsImageProvider } from './providers/oxylabs';
import { ScraperApiImageProvider } from './providers/scraperapi';
import { SearchApiImageProvider } from './providers/searchapi';
import { SerpApiImageProvider } from './providers/serpapi';
import { SerperImageProvider } from './providers/serper';
import { SkuMonsterImageProvider } from './providers/skumonster';
import { TavilyImageProvider } from './providers/tavily';
import { ZenserpImageProvider } from './providers/zenserp';

// Placeholder for the two not-implemented brand crawlers (imported to keep the
// class usage pattern uniform). They cannot be enabled, so this stub is only a
// safety net.
function notImplementedProvider(slug: string): ImageProvider {
  return {
    slug,
    config: {},
    search: async () => {
      throw new ProviderError('Este servicio todavía no está implementado');
    }
  } as unknown as ImageProvider;
}

export const IMAGE_PROVIDERS: ImageProviderDefinition[] = [
  { slug: 'mock', name: 'Mock (desarrollo)', auth_kind: 'none', implemented: true, create: (config) => new MockImageProvider(config) },
  { slug: 'apify', name: 'Apify', auth_kind: 'api_key', implemented: true, extraConfigFields: [{ key: 'actor_id', label: 'Actor ID (p. ej. apify/google-images-scraper)' }], create: (config) => new ApifyImageProvider(config) },
  { slug: 'barcodelookup', name: 'BarcodeLookup (por EAN)', auth_kind: 'api_key', implemented: true, create: (config) => new BarcodeLookupImageProvider(config) },
  { slug: 'brave_images', name: 'Brave Images API', auth_kind: 'api_key', implemented: true, create: (config) => new BraveImageProvider(config) },
  { slug: 'brightdata', name: 'Bright Data (SERP de Google Images)', auth_kind: 'api_key', implemented: true, extraConfigFields: [{ key: 'zone', label: 'Zona de Bright Data' }], create: (config) => new BrightDataImageProvider(config) },
  { slug: 'dataforseo', name: 'DataForSEO (Google Images)', auth_kind: 'user_password', implemented: true, extraConfigFields: [{ key: 'location_name', label: 'Ubicación (predeterminada: Spain)' }, { key: 'language_name', label: 'Idioma (predeterminado: Spanish)' }], create: (config) => new DataForSEOImageProvider(config) },
  { slug: 'decodo_premium', name: 'Decodo', auth_kind: 'user_password', implemented: true, create: (config) => new DecodoImageProvider(config) },
  { slug: 'ddgs', name: 'DDGS (DuckDuckGo Images)', auth_kind: 'none', implemented: true, create: (config) => new DdgsImageProvider(config) },
  { slug: 'exa', name: 'Exa (búsqueda semántica)', auth_kind: 'api_key', implemented: true, create: (config) => new ExaImageProvider(config) },
  { slug: 'feeds', name: 'Feeds/archivos locales de proveedor', auth_kind: 'none', implemented: true, alwaysFirst: true, create: (config) => new FeedsImageProvider(config) },
  { slug: 'firecrawl', name: 'Firecrawl', auth_kind: 'api_key', implemented: true, create: (config) => new FirecrawlImageProvider(config) },
  { slug: 'nexscope', name: 'Nexscope (búsqueda Amazon)', auth_kind: 'api_key', implemented: true, extraConfigFields: [{ key: 'marketplace', label: 'Marketplace (predeterminado: amazon.es)' }], create: (config) => new NexscopeImageProvider(config) },
  { slug: 'openserp', name: 'OpenSERP', auth_kind: 'api_key', implemented: true, create: (config) => new OpenSerpImageProvider(config) },
  { slug: 'oxylabs', name: 'Oxylabs (Google Images)', auth_kind: 'user_password', implemented: true, create: (config) => new OxylabsImageProvider(config) },
  { slug: 'scraper_js', name: 'Rastreador de marca con navegador (Playwright)', auth_kind: 'none', implemented: false, create: () => notImplementedProvider('scraper_js') },
  { slug: 'scraper', name: 'Rastreador de la web de la marca', auth_kind: 'none', implemented: false, create: () => notImplementedProvider('scraper') },
  { slug: 'scraperapi', name: 'ScraperAPI (Google Images)', auth_kind: 'api_key', implemented: true, create: (config) => new ScraperApiImageProvider(config) },
  { slug: 'searchapi', name: 'SearchAPI (Google Images)', auth_kind: 'api_key', implemented: true, create: (config) => new SearchApiImageProvider(config) },
  { slug: 'serpapi', name: 'SerpAPI (Google Images)', auth_kind: 'api_key', implemented: true, create: (config) => new SerpApiImageProvider(config) },
  { slug: 'serper', name: 'Serper (Google Images)', auth_kind: 'api_key', implemented: true, create: (config) => new SerperImageProvider(config) },
  { slug: 'skumonster', name: 'SkuMonster (por UPC/EAN/SKU)', auth_kind: 'api_key', implemented: true, extraConfigFields: [{ key: 'base_url', label: 'Base URL (predeterminado: https://api.skumonster.com)' }], create: (config) => new SkuMonsterImageProvider(config) },
  { slug: 'tavily', name: 'Tavily', auth_kind: 'api_key', implemented: true, create: (config) => new TavilyImageProvider(config) },
  { slug: 'zenserp', name: 'Zenserp', auth_kind: 'api_key', implemented: true, create: (config) => new ZenserpImageProvider(config) }
];

export function getImageProviderDefinition(slug: string): ImageProviderDefinition | undefined {
  return IMAGE_PROVIDERS.find((definition) => definition.slug === slug);
}

// Seeds the image_providers table on startup (idempotent). Only the mock
// service is enabled by default so development and tests work without any
// external API key; every real service starts disabled.
export function seedImageProviders(): void {
  IMAGE_PROVIDERS.forEach((definition, index) => {
    upsertImageProvider({
      slug: definition.slug,
      name: definition.name,
      sort_order: index,
      enabled: definition.slug === 'mock',
      config: {}
    });
  });
}