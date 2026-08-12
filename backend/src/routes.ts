// API routes for Catalog AI.
// Wires the frontend contract to the processing modules and an in-memory store.

import { NextFunction, Request, Response, Router } from 'express';
import { AppError } from './utils/error-handler';
import { logger } from './utils/logger';
import { DataStore } from './store';
import { AITextSuggester, getAIProviderBaseUrl } from './modules/ai-text-suggester/ai-text-suggester';
import { DEFAULT_AI_PROMPTS } from './modules/ai-text-suggester/default-prompts';
import {
  AI_COMPLETION_RESPONSE_INSTRUCTIONS,
  AUTOCOMPLETE_FIELDS,
  extractCompletionProposals,
  fillPrompt,
  parseCompletionResponse
} from './modules/ai-text-suggester/autocomplete';
import { PrestaShopClient } from './modules/prestashop-client/prestashop-client';
import { PrestaShopFetcher, PRESTASHOP_FETCH_LIMIT } from './modules/prestashop-fetcher/prestashop-fetcher';
import { ConfigPersistence } from './modules/config-persistence/config-persistence';
import { AIConfig, AIProviderName, AIProviderSettings, PrestaShopConfig, PrestaShopProductUpdate, ProductData } from './types';

export interface RouteDependencies {
  store: DataStore;
  prestashopClientFactory?: (config: PrestaShopConfig) => PrestaShopClient;
  configPersistence?: ConfigPersistence;
}

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

const wrap = (fn: AsyncHandler) => (req: Request, res: Response, next: NextFunction): void => {
  fn(req, res, next).catch(next);
};

const FLAT_SETTING_KEYS = ['model', 'api_key', 'language', 'base_url'] as const;

// Builds the flat effective AI config used by the suggesters for the provider
// being tested: the stored settings of that provider merged with the settings
// sent by the form (the fields the user is currently editing).
function buildAIConfig(store: DataStore, body: any): AIConfig {
  const ai = store.config.ai;
  const provider = (body?.provider ?? ai.provider) as AIProviderName;
  const stored: AIProviderSettings = { ...(ai.providers?.[provider] ?? {}) };
  const flat: AIProviderSettings = {};
  for (const key of FLAT_SETTING_KEYS) {
    if (body?.[key] !== undefined) flat[key] = body[key];
  }
  return {
    provider,
    ...stored,
    ...flat,
    enabled_fields: Array.isArray(body?.enabled_fields) ? body.enabled_fields : ai.enabled_fields,
    max_requests_per_minute: body?.max_requests_per_minute ?? ai.max_requests_per_minute,
    temperature: body?.temperature ?? ai.temperature,
    default_prompt: body?.default_prompt ?? ai.default_prompt
  };
}

// Merges an AI config update into the stored per-provider settings. The active
// provider keeps its flat mirror in sync so the suggesters (and the effective
// base URL report) keep working unchanged, while every other provider's saved
// settings stay untouched.
function mergeAIConfig(current: AIConfig, update: any): AIConfig {
  const provider = (update?.provider ?? current.provider) as AIProviderName;
  const providers: Partial<Record<AIProviderName, AIProviderSettings>> = { ...(current.providers ?? {}) };

  if (update?.providers && typeof update.providers === 'object') {
    for (const [name, settings] of Object.entries(update.providers)) {
      if (!settings) continue;
      providers[name as AIProviderName] = {
        ...(providers[name as AIProviderName] ?? {}),
        ...(settings as AIProviderSettings)
      };
    }
  }

  const flat: AIProviderSettings = {};
  for (const key of FLAT_SETTING_KEYS) {
    if (update?.[key] !== undefined) flat[key] = update[key];
  }
  if (Object.keys(flat).length > 0) {
    providers[provider] = { ...(providers[provider] ?? {}), ...flat };
  }

  const active = providers[provider] ?? {};
  return {
    provider,
    providers,
    model: active.model,
    api_key: active.api_key,
    language: active.language,
    base_url: active.base_url,
    enabled_fields: Array.isArray(update?.enabled_fields) ? update.enabled_fields : current.enabled_fields,
    max_requests_per_minute: update?.max_requests_per_minute ?? current.max_requests_per_minute,
    temperature: update?.temperature ?? current.temperature,
    default_prompt: update?.default_prompt !== undefined ? update.default_prompt : current.default_prompt
  };
}

function buildPrestashopClient(deps: RouteDependencies, config: PrestaShopConfig): PrestaShopClient {
  return deps.prestashopClientFactory ? deps.prestashopClientFactory(config) : new PrestaShopClient(config);
}

function hasPrestashopConfig(config: PrestaShopConfig): boolean {
  return Boolean(config.base_url && config.api_key);
}

export function createApiRouter(deps: RouteDependencies): Router {
  const { store } = deps;
  const router = Router();

  // Health and status
  router.get('/health', (_req, res) => {
    res.json({ success: true, status: 'ok' });
  });

  router.get('/logs', (_req, res) => {
    res.json({ success: true, data: [] });
  });

  // Configuration
  router.get('/config', (_req, res) => {
    res.json({
      success: true,
      ...store.config,
      // Report the effective AI endpoint (the configured provider's default URL
      // when no explicit base_url is set) so the UI can show which URL is used.
      ai: store.config.ai ? { ...store.config.ai, base_url: getAIProviderBaseUrl(store.config.ai) } : store.config.ai
    });
  });

  router.put('/config', (req, res) => {
    const body = req.body ?? {};
    const next = { ...store.config };

    if (body.prestashop) next.prestashop = { ...next.prestashop, ...body.prestashop };
    if (body.ai) next.ai = mergeAIConfig(next.ai, body.ai);

    store.config = next;
    deps.configPersistence?.save(next);
    res.json({ success: true, message: 'Configuration saved', ...store.config });
  });

  // System default AI prompt (in every supported language) used to request the
  // fields the user wants to complete. Users can override it through the config
  // panel, which stores the custom text in AIConfig.default_prompt.
  router.get('/config/default-prompt', (_req, res) => {
    res.json({ success: true, data: DEFAULT_AI_PROMPTS });
  });

  router.post(
    '/config/test/prestashop',
    wrap(async (req, res) => {
      const body = req.body ?? {};
      const config: PrestaShopConfig = { ...store.config.prestashop, ...body };

      if (!config.base_url) throw new AppError('PrestaShop base URL is required', 400);
      if (!config.api_key) throw new AppError('PrestaShop API key is required', 400);

      const client = buildPrestashopClient(deps, config);
      const ok = await client.testConnection();
      if (!ok) throw new AppError('PrestaShop connection failed - check the URL and API key', 400);

      res.json({ success: true, message: 'PrestaShop connection successful' });
    })
  );

  router.post(
    '/config/test/ai',
    wrap(async (req, res) => {
      const config = buildAIConfig(store, req.body ?? {});
      const suggester = new AITextSuggester(config);
      const baseUrl = getAIProviderBaseUrl(config);
      logger.info('AI connection test', { provider: config.provider, model: config.model ?? '', baseUrl });
      const testProduct = {
        id: 'test',
        status: 'pending',
        source_file: 'test',
        validation_errors: [],
        warnings: [],
        name: '',
        category: 'test',
        brand: 'test'
      } as ProductData;

      const suggestions = await suggester.generateSuggestions(testProduct);
      if (!Array.isArray(suggestions)) {
        logger.error('AI connection test failed', { provider: config.provider, model: config.model ?? '', baseUrl });
        throw new AppError('AI connection test failed', 400);
      }

      logger.info('AI connection test succeeded', { provider: config.provider, model: config.model ?? '', baseUrl });
      res.json({ success: true, message: 'AI connection successful' });
    })
  );

  // AI autocomplete: asks the selected provider to propose values for the empty
  // text fields of one product. The message sent to the AI is the saved prompt
  // (custom, or the system default for the UI language) with every {{PLACEHOLDER}}
  // replaced by the product data, plus the fixed JSON-response contract. The
  // provider's answer is parsed and only the non-empty proposals are returned.
  router.post(
    '/autocomplete',
    wrap(async (req, res) => {
      const body = req.body ?? {};
      const product = body.product as ProductData | undefined;
      if (!product || typeof product !== 'object' || Array.isArray(product)) {
        throw new AppError('A product is required to autocomplete its fields', 400);
      }

      const ai = store.config.ai;
      const language =
        body.language === 'es' || body.language === 'en'
          ? body.language
          : ai.language === 'en'
            ? 'en'
            : 'es';
      const promptSource = ai.default_prompt?.trim() || DEFAULT_AI_PROMPTS[language] || DEFAULT_AI_PROMPTS.en;
      const message = `${fillPrompt(promptSource, product)}\n\n${AI_COMPLETION_RESPONSE_INSTRUCTIONS}`;

      const suggester = new AITextSuggester(ai);

      let raw: string;
      try {
        raw = await suggester.complete({ prompt: message, product, fields: AUTOCOMPLETE_FIELDS });
      } catch (error) {
        throw new AppError(
          `AI autocomplete failed: ${error instanceof Error ? error.message : String(error)}`,
          502
        );
      }

      let parsed: any;
      try {
        parsed = parseCompletionResponse(raw);
      } catch {
        throw new AppError('The AI response was not valid JSON matching the expected structure', 502);
      }

      const proposals = extractCompletionProposals(parsed, AUTOCOMPLETE_FIELDS);
      res.json({
        success: true,
        data: {
          reference: product.reference ?? '',
          status: typeof parsed.status === 'string' ? parsed.status : 'unknown',
          confidence: typeof parsed.confidence === 'number' ? parsed.confidence : null,
          warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
          proposals
        }
      });
    })
  );

  // PrestaShop Webservice fetch
  // Builds a working dataset straight from PrestaShop (by reference and/or
  // brand, with optional filters) as the data source for the import.
  router.post(
    '/fetch/prestashop',
    wrap(async (req, res) => {
      const prestashop = store.config.prestashop;
      if (!hasPrestashopConfig(prestashop)) {
        throw new AppError('PrestaShop must be configured to fetch products', 400);
      }

      const body = req.body ?? {};
      const references = Array.isArray(body.references) ? (body.references as string[]) : [];
      const normalizedReferences = references.map((reference) => String(reference).trim()).filter(Boolean);

      const client = buildPrestashopClient(deps, prestashop);
      const fetcher = new PrestaShopFetcher(client);
      const products = await fetcher.fetch({
        references: normalizedReferences,
        brand: typeof body.brand === 'string' ? body.brand : '',
        description: body.description === 'with' || body.description === 'without' ? body.description : 'all',
        images: body.images === 'with' || body.images === 'without' ? body.images : 'all',
        filter_operator: body.filter_operator === 'or' ? 'or' : 'and',
        limit: PRESTASHOP_FETCH_LIMIT
      });

      if (products.length === 0) {
        throw new AppError('No products matched the given criteria', 404);
      }

      const dataId = store.newId('ps');
      store.prestashopDataset = {
        dataId,
        fileId: dataId,
        fileName: 'PrestaShop',
        products,
        totalRows: products.length
      };

      res.json({
        success: true,
        message: `${products.length} product(s) fetched from PrestaShop`,
        data: {
          data_id: dataId,
          products,
          summary: { total: products.length }
        }
      });
    })
  );

  router.get('/fetch/prestashop', (req, res) => {
    const dataset = store.prestashopDataset;
    res.json({
      success: true,
      data: dataset
        ? { data_id: dataset.dataId, products: dataset.products, summary: { total: dataset.products.length } }
        : null
    });
  });

  router.delete('/fetch/prestashop', (req, res) => {
    store.prestashopDataset = undefined;
    res.json({ success: true, message: 'PrestaShop data discarded' });
  });

  // Proxies a PrestaShop product image as raw bytes. The dataset stores images
  // as backend-relative paths so the shop's API key never reaches the browser.
  router.get(
    '/fetch/prestashop/images/:productId/:imageId',
    wrap(async (req, res) => {
      const { productId, imageId } = req.params;
      const prestashop = store.config.prestashop;
      if (!hasPrestashopConfig(prestashop)) {
        throw new AppError('PrestaShop must be configured to fetch products', 400);
      }

      const client = buildPrestashopClient(deps, prestashop);
      let buffer: Buffer;
      try {
        buffer = await client.fetchProductImage(productId, imageId);
      } catch {
        throw new AppError('PrestaShop image not found', 404);
      }

      res.set('Content-Type', sniffImageContentType(buffer));
      res.set('Cache-Control', 'private, max-age=3600');
      res.send(buffer);
    })
  );

  // Pushes user edits back to PrestaShop. Only the editable product fields the
  // frontend actually changed are accepted (per-product deltas); unknown or
  // non-string fields are dropped so nothing else can be written to the shop.
  router.post(
    '/fetch/prestashop/save',
    wrap(async (req, res) => {
      const prestashop = store.config.prestashop;
      if (!hasPrestashopConfig(prestashop)) {
        throw new AppError('PrestaShop must be configured to save products', 400);
      }

      const updates = (req.body ?? {}).updates;
      if (!updates || typeof updates !== 'object' || Array.isArray(updates) || Object.keys(updates).length === 0) {
        throw new AppError('No product updates were provided', 400);
      }

      const client = buildPrestashopClient(deps, prestashop);
      const entries = Object.entries(updates as Record<string, unknown>);
      const results: Record<string, boolean> = {};
      const failures: string[] = [];
      let saved = 0;

      for (const [productId, rawFields] of entries) {
        const fields = sanitizeProductUpdate(rawFields);
        if (Object.keys(fields).length === 0) {
          results[productId] = false;
          failures.push(`no editable fields for product ${productId}`);
          continue;
        }
        try {
          await client.updateProduct(productId, fields);
          results[productId] = true;
          saved += 1;
        } catch (error) {
          // Error instances serialize to `{}` in the log, so surface the message
          // explicitly (the error handler elsewhere logs the full stack).
          logger.error('Failed to update PrestaShop product', {
            productId,
            error: error instanceof Error ? error.message : String(error)
          });
          results[productId] = false;
          failures.push(error instanceof Error ? error.message : String(error));
        }
      }

      if (saved === 0) {
        const reason = Array.from(new Set(failures))[0];
        throw new AppError(
          reason
            ? `None of the products could be updated in PrestaShop: ${reason}`
            : 'None of the products could be updated in PrestaShop',
          500
        );
      }

      res.json({
        success: true,
        message: `${saved} of ${entries.length} product(s) updated in PrestaShop`,
        data: { saved, failed: entries.length - saved, results }
      });
    })
  );

  return router;
}

// Keeps only the editable product fields with string values, so the save
// endpoint can never write anything else to the PrestaShop Webservice.
function sanitizeProductUpdate(rawFields: unknown): PrestaShopProductUpdate {
  if (!rawFields || typeof rawFields !== 'object' || Array.isArray(rawFields)) return {};
  const source = rawFields as Record<string, unknown>;
  const result: PrestaShopProductUpdate = {};
  if (typeof source.description_short === 'string') result.description_short = source.description_short;
  if (typeof source.description === 'string') result.description = source.description;
  if (typeof source.meta_title === 'string') result.meta_title = source.meta_title;
  if (typeof source.meta_description === 'string') result.meta_description = source.meta_description;
  return result;
}

// Detects the image format from its magic bytes so the proxy can send the right
// Content-Type (PrestaShop stores product images as PNG or JPEG).
function sniffImageContentType(buffer: Buffer): string {
  if (buffer.length > 2 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    buffer.length > 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return 'image/png';
  }
  if (buffer.length > 3 && buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
    return 'image/gif';
  }
  if (
    buffer.length > 12 &&
    buffer.subarray(0, 4).toString() === 'RIFF' &&
    buffer.subarray(8, 12).toString() === 'WEBP'
  ) {
    return 'image/webp';
  }
  return 'application/octet-stream';
}
