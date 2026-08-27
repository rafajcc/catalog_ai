// API routes for Catalog AI.
// Wires the frontend contract to the processing modules and an in-memory store.

import { NextFunction, Request, Response, Router } from 'express';
import { AppError } from './utils/error-handler';
import { logger } from './utils/logger';
import { AITextSuggester, getAIProviderBaseUrl } from './modules/ai-text-suggester/ai-text-suggester';
import { DEFAULT_AI_PROMPTS } from './modules/ai-text-suggester/default-prompts';
import {
  AI_COMPLETION_RESPONSE_INSTRUCTIONS,
  AUTOCOMPLETE_FIELDS,
  extractCompletionProposals,
  extractImageUrls,
  fillPrompt,
  parseCompletionResponse
} from './modules/ai-text-suggester/autocomplete';
import { PrestaShopClient } from './modules/prestashop-client/prestashop-client';
import { PrestaShopFetcher, PRESTASHOP_FETCH_LIMIT } from './modules/prestashop-fetcher/prestashop-fetcher';
import { AIConfig, AIProviderName, AIProviderSettings, PrestaShopConfig, PrestaShopProductUpdate, ProductData } from './types';
import { requireAuth, requireRole } from './modules/auth/middleware';

export interface RouteDependencies {
  prestashopClientFactory?: (config: PrestaShopConfig) => PrestaShopClient;
}

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

const wrap = (fn: AsyncHandler) => (req: Request, res: Response, next: NextFunction): void => {
  fn(req, res, next).catch(next);
};

const FLAT_SETTING_KEYS = ['model', 'api_key', 'language', 'base_url'] as const;

const PROVIDER_LABELS: Record<string, string> = {
  mock: 'Mock',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  openrouter: 'OpenRouter',
  gpt4all: 'GPT4All'
};

function translateAIError(error: unknown, provider: AIProviderName): string {
  const raw = error instanceof Error ? error.message : String(error);
  const name = PROVIDER_LABELS[provider] ?? provider;

  if (/\b401\b/.test(raw)) return `La clave de API de ${name} no es válida. Revisa la configuración del proveedor`;
  if (/\b403\b/.test(raw)) return `${name} denegó el acceso. Verifica que tu clave de API tenga permisos`;
  if (/\b404\b/.test(raw)) return `${name} no encontró el servicio. Revisa la URL de configuración del proveedor`;
  if (/\b429\b/.test(raw)) return `${name} respondió que se alcanzó el límite de solicitudes. Espera un momento e intenta de nuevo`;
  if (/\b400\b/.test(raw)) return `${name} rechazó la solicitud. Revisa la configuración del proveedor`;
  if (/\b5[0-9][0-9]\b/.test(raw)) return `${name} tuvo un error interno. Intenta de nuevo más tarde`;
  if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EHOSTUNREACH/i.test(raw)) return `No se pudo conectar con ${name}. Verifica la URL y que el servicio esté disponible`;
  if (/timeout/i.test(raw)) return `${name} tardó demasiado en responder. Intenta de nuevo`;
  if (/network|fetch failed/i.test(raw)) return `Error de red al contactar ${name}`;
  return `Error al conectar con ${name}: ${raw}`;
}

function translatePrestashopError(error: unknown, marketplace = 'PrestaShop'): string {
  const raw = error instanceof Error ? error.message : String(error);

  if (/Invalid PrestaShop API key/i.test(raw)) return `La clave de API de ${marketplace} no es válida. Revisa la configuración del marketplace`;
  if (/\b401\b/.test(raw)) return `La clave de API de ${marketplace} no es válida. Revisa la configuración del marketplace`;
  if (/\b403\b/.test(raw)) return `${marketplace} denegó el acceso. Verifica los permisos de tu clave de API`;
  if (/\b404\b/.test(raw)) return `${marketplace} no encontró el recurso solicitado. Verifica la URL y los parámetros`;
  if (/\b429\b/.test(raw)) return `${marketplace} respondió que se alcanzó el límite de solicitudes. Espera un momento e intenta de nuevo`;
  if (/\b5[0-9][0-9]\b/.test(raw)) return `${marketplace} tuvo un error interno. Intenta de nuevo más tarde`;
  if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EHOSTUNREACH/i.test(raw)) return `No se pudo conectar con ${marketplace}. Verifica la URL base y que la tienda esté disponible`;
  if (/timeout/i.test(raw)) return `${marketplace} tardó demasiado en responder. Intenta de nuevo`;
  if (/network|fetch failed/i.test(raw)) return `Error de red al contactar ${marketplace}`;
  return `Error al conectar con ${marketplace}: ${raw}`;
}

// Builds the flat effective AI config used by the suggesters for the provider
// being tested: the stored settings of that provider merged with the settings
// sent by the form (the fields the user is currently editing).
function buildAIConfig(config: AIConfig, body: any): AIConfig {
  const ai = config;
  const provider = (body?.provider ?? ai.provider) as AIProviderName;
  const stored: AIProviderSettings = { ...(ai.providers?.[provider] ?? {}) };
  const flat: AIProviderSettings = {};
  for (const key of FLAT_SETTING_KEYS) {
    if (body?.[key] !== undefined && body[key] !== '') flat[key] = body[key];
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
  const router = Router();

  // Health and status
  router.get('/health', (_req, res) => {
    res.json({ success: true, status: 'ok' });
  });

  router.get('/logs', (_req, res) => {
    res.json({ success: true, data: [] });
  });

  // Configuration – readable by any authenticated user, API keys are masked
  router.get('/config', requireAuth, (req, res) => {
    const config = { ...req.store!.config };
    const aiConfig = config.ai ? { ...config.ai } : undefined;
    if (aiConfig) {
      aiConfig.api_key = '';
      aiConfig.has_api_key = Boolean(config.ai!.api_key);
      if (aiConfig.providers) {
        const maskedProviders: Partial<Record<AIProviderName, AIProviderSettings>> = {};
        for (const [name, settings] of Object.entries(aiConfig.providers)) {
          const s = settings as AIProviderSettings;
          maskedProviders[name as AIProviderName] = {
            ...s,
            api_key: '',
            has_api_key: Boolean(s.api_key)
          };
        }
        aiConfig.providers = maskedProviders;
      }
    }
    const psConfig = config.prestashop
      ? { ...config.prestashop, api_key: '', has_api_key: Boolean(config.prestashop.api_key) }
      : config.prestashop;
    res.json({
      success: true,
      prestashop: psConfig,
      ai: aiConfig ? { ...aiConfig, base_url: getAIProviderBaseUrl(req.store!.config.ai) } : aiConfig
    });
  });

  // Config write and test endpoints require auth; config mutation requires admin
  router.put('/config', requireAuth, requireRole('admin', 'user'), (req, res) => {
    const body = req.body ?? {};
    const next = { ...req.store!.config };

    // Users with role "user" can only change the active AI provider and prompt
    if (req.user!.role === 'user') {
      const allowedTopKeys = ['ai'];
      const disallowed = Object.keys(body).filter((k) => !allowedTopKeys.includes(k));
      if (disallowed.length > 0) {
        throw new AppError('Insufficient permissions to modify configuration: ' + disallowed.join(', '), 403);
      }
      if (body.ai) {
        const allowedAiKeys = ['provider', 'default_prompt'];
        const aiKeys = Object.keys(body.ai);
        const disallowedAi = aiKeys.filter((k) => !allowedAiKeys.includes(k));
        if (disallowedAi.length > 0) {
          throw new AppError('Insufficient permissions to modify AI settings: ' + disallowedAi.join(', '), 403);
        }
      }
    }

    // PrestaShop: preserve API key if the frontend sent an empty placeholder
    if (body.prestashop) {
      const psUpdate = { ...body.prestashop };
      if (!psUpdate.api_key || psUpdate.api_key === '') {
        delete psUpdate.api_key;
      }
      next.prestashop = { ...next.prestashop, ...psUpdate };
    }

    if (body.ai) {
      // Strip masked API key placeholders before merging
      const aiUpdate = { ...body.ai };
      if (aiUpdate.providers && typeof aiUpdate.providers === 'object') {
        for (const [name, settings] of Object.entries(aiUpdate.providers)) {
          if (settings && typeof settings === 'object') {
            const s = settings as any;
            if (!s.api_key || s.api_key === '') delete s.api_key;
          }
        }
      }
      if (!aiUpdate.api_key || aiUpdate.api_key === '') delete aiUpdate.api_key;
      next.ai = mergeAIConfig(next.ai, aiUpdate);
    }

    req.store!.config = next;
    req.configPersistence?.save(next);
    res.json({ success: true, message: 'Configuration saved', ...req.store!.config });
  });

  // System default AI prompt (in every supported language) used to request the
  // fields the user wants to complete. Users can override it through the config
  // panel, which stores the custom text in AIConfig.default_prompt.
  router.get('/config/default-prompt', (_req, res) => {
    res.json({ success: true, data: DEFAULT_AI_PROMPTS });
  });

  // Resets the custom prompt back to the system default for the given language.
  // Removes the stored default_prompt so the system prompt is used again.
  router.post('/config/reset-prompt', requireAuth, requireRole('admin'), (req, res) => {
    delete req.store!.config.ai.default_prompt;
    req.configPersistence?.save(req.store!.config);
    res.json({ success: true, message: 'Prompt reset to system default' });
  });

  router.post(
    '/config/test/prestashop',
    requireAuth,
    wrap(async (req, res) => {
      const body = req.body ?? {};
      const saved = req.store?.config.prestashop;
      const config: PrestaShopConfig = {
        base_url: body.base_url ?? '',
        api_key: body.api_key || saved?.api_key || '',
        version: body.version ?? '1.7',
        language_id: body.language_id ?? 1
      };

      if (!config.base_url) throw new AppError('La URL base de PrestaShop es obligatoria', 400);
      if (!config.api_key) throw new AppError('La API key de PrestaShop es obligatoria', 400);

      const client = buildPrestashopClient(deps, config);
      const ok = await client.testConnection();
      if (!ok) throw new AppError('No se pudo conectar con PrestaShop. Verifica la URL y la API key', 400);

      res.json({ success: true, message: 'Conexión con PrestaShop correcta' });
    })
  );

  router.post(
    '/config/test/ai',
    requireAuth,
    wrap(async (req, res) => {
      const body = req.body ?? {};
      const aiConfig = req.store?.config.ai;
      const config = buildAIConfig(aiConfig ? { ...aiConfig, ...body } : body, body);
      const suggester = new AITextSuggester(config);
      const baseUrl = getAIProviderBaseUrl(config);
      logger.info('AI connection test', { provider: config.provider, model: config.model ?? '', baseUrl });

      // The mock and local GPT4All providers only check connectivity, while the
      // cloud providers make a real authenticated call, so a missing or invalid
      // API key surfaces here as a failure instead of a fake success.
      try {
        await suggester.testConnection();
      } catch (error) {
        logger.error('AI connection test failed', {
          provider: config.provider,
          model: config.model ?? '',
          baseUrl,
          error: error instanceof Error ? error.message : String(error)
        });
        throw new AppError(translateAIError(error, config.provider), 400);
      }

      logger.info('AI connection test succeeded', { provider: config.provider, model: config.model ?? '', baseUrl });
      res.json({ success: true, message: 'Conexión con IA correcta' });
    })
  );

  // AI autocomplete: asks the selected provider to propose values for the empty
  // text fields of one product. The message sent to the AI is the saved prompt
  // (custom, or the system default for the UI language) with every {{PLACEHOLDER}}
  // replaced by the product data, plus the fixed JSON-response contract. The
  // provider's answer is parsed and only the non-empty proposals are returned.
  router.post(
    '/autocomplete',
    requireAuth,
    wrap(async (req, res) => {
      const body = req.body ?? {};
      const product = body.product as ProductData | undefined;
      if (!product || typeof product !== 'object' || Array.isArray(product)) {
        throw new AppError('A product is required to autocomplete its fields', 400);
      }

      const ai = req.store!.config.ai;

      // Allow overriding the AI provider per-request so the user can test
      // different providers from the Products view without changing config.
      let effectiveAI = ai;
      const requestedProvider = body.provider as string | undefined;
      if (requestedProvider && requestedProvider !== ai.provider) {
        const providerSettings = ai.providers?.[requestedProvider as keyof typeof ai.providers];
        effectiveAI = {
          ...ai,
          provider: requestedProvider as any,
          ...(providerSettings?.model != null ? { model: providerSettings.model } : {}),
          ...(providerSettings?.api_key != null ? { api_key: providerSettings.api_key } : {}),
          ...(providerSettings?.base_url != null ? { base_url: providerSettings.base_url } : {}),
          ...(providerSettings?.language != null ? { language: providerSettings.language } : {}),
          ...(providerSettings?.temperature != null ? { temperature: providerSettings.temperature } : {})
        };
      }

      const language =
        body.language === 'es' || body.language === 'en'
          ? body.language
          : effectiveAI.language === 'en'
            ? 'en'
            : 'es';
      const promptSource = effectiveAI.default_prompt?.trim() || DEFAULT_AI_PROMPTS[language] || DEFAULT_AI_PROMPTS.en;
      const imagesNeeded = Math.max(0, 5 - (product.images?.length ?? 0));
      const imageInstruction = imagesNeeded > 0
        ? `\n\nIMÁGENES NECESARIAS: ${imagesNeeded}. Busca en la web y devuelve exactamente ${imagesNeeded} URLs de imágenes del producto en el campo "image_urls".`
        : `\n\nEl producto ya tiene 5 o más imágenes. Devuelve un array vacío en "image_urls".`;
      const message = `${fillPrompt(promptSource, product)}\n\n${AI_COMPLETION_RESPONSE_INSTRUCTIONS}${imageInstruction}`;

      const suggester = new AITextSuggester(effectiveAI);

      let raw: string;
      try {
        raw = await suggester.complete({ prompt: message, product, fields: AUTOCOMPLETE_FIELDS, imagesNeeded });
      } catch (error) {
        throw new AppError(
          translateAIError(error, effectiveAI.provider),
          400
        );
      }

      let parsed: any;
      try {
        parsed = parseCompletionResponse(raw);
      } catch {
        throw new AppError('The AI response was not valid JSON matching the expected structure', 502);
      }

      const proposals = extractCompletionProposals(parsed, AUTOCOMPLETE_FIELDS);
      const imageUrls = extractImageUrls(parsed);
      res.json({
        success: true,
        data: {
          reference: product.reference ?? '',
          status: typeof parsed.status === 'string' ? parsed.status : 'unknown',
          confidence: typeof parsed.confidence === 'number' ? parsed.confidence : null,
          warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
          proposals,
          image_urls: imageUrls
        }
      });
    })
  );

  // PrestaShop Webservice fetch
  // Builds a working dataset straight from PrestaShop (by reference and/or
  // brand, with optional filters) as the data source for the import.
  router.post(
    '/fetch/prestashop',
    requireAuth,
    wrap(async (req, res) => {
      const prestashop = req.store!.config.prestashop;
      if (!hasPrestashopConfig(prestashop)) {
        throw new AppError('PrestaShop must be configured to fetch products', 400);
      }

      const body = req.body ?? {};
      const references = Array.isArray(body.references) ? (body.references as string[]) : [];
      const normalizedReferences = references.map((reference) => String(reference).trim()).filter(Boolean);

      const client = buildPrestashopClient(deps, prestashop);
      const fetcher = new PrestaShopFetcher(client);
      let products;
      try {
        products = await fetcher.fetch({
          references: normalizedReferences,
          brand: typeof body.brand === 'string' ? body.brand : '',
          description: body.description === 'with' || body.description === 'without' ? body.description : 'all',
          images: body.images === 'with' || body.images === 'without' ? body.images : 'all',
          filter_operator: body.filter_operator === 'or' ? 'or' : 'and',
          limit: PRESTASHOP_FETCH_LIMIT
        });
      } catch (error) {
        throw new AppError(translatePrestashopError(error, 'PrestaShop'), 400);
      }

      if (products.length === 0) {
        throw new AppError('No products matched the given criteria', 404);
      }

      const dataId = req.store!.newId('ps');
      req.store!.prestashopDataset = {
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

  router.get('/fetch/prestashop', requireAuth, (req, res) => {
    const dataset = req.store!.prestashopDataset;
    res.json({
      success: true,
      data: dataset
        ? { data_id: dataset.dataId, products: dataset.products, summary: { total: dataset.products.length } }
        : null
    });
  });

  router.delete('/fetch/prestashop', requireAuth, (req, res) => {
    req.store!.prestashopDataset = undefined;
    res.json({ success: true, message: 'PrestaShop data discarded' });
  });

  // Proxies a PrestaShop product image as raw bytes. The dataset stores images
  // as backend-relative paths so the shop's API key never reaches the browser.
  router.get(
    '/fetch/prestashop/images/:productId/:imageId',
    requireAuth,
    wrap(async (req, res) => {
      const { productId, imageId } = req.params;
      const prestashop = req.store!.config.prestashop;
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

  // Proxies an external image URL as raw bytes. Used by the autocomplete
  // feature to download product images found on the web.
  router.get(
    '/images/proxy',
    requireAuth,
    wrap(async (req, res) => {
      const url = req.query.url;
      if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
        throw new AppError('A valid http(s) image URL is required', 400);
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      let response: globalThis.Response;
      try {
        response = await fetch(url, {
          signal: controller.signal,
          headers: { 'User-Agent': 'CatalogAI/1.0' }
        });
      } catch {
        clearTimeout(timeout);
        throw new AppError('Failed to fetch the external image', 502);
      }
      clearTimeout(timeout);

      if (!response.ok) {
        throw new AppError('External image server returned an error', 502);
      }

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.startsWith('image/')) {
        throw new AppError('The URL does not point to an image', 400);
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      res.set('Content-Type', contentType.split(';')[0].trim());
      res.set('Cache-Control', 'private, max-age=86400');
      res.send(buffer);
    })
  );

  router.delete(
    '/fetch/prestashop/images/:productId/:imageId',
    requireAuth,
    wrap(async (req, res) => {
      const prestashop = req.store!.config.prestashop;
      if (!hasPrestashopConfig(prestashop)) {
        throw new AppError('PrestaShop must be configured', 400);
      }
      const { productId, imageId } = req.params;
      const client = buildPrestashopClient(deps, prestashop);
      try {
        await client.deleteProductImage(productId, imageId);
        res.json({ success: true, message: 'Image deleted' });
      } catch (error) {
        const msg = translatePrestashopError(error, 'PrestaShop');
        throw new AppError(msg, 400);
      }
    })
  );

  // Pushes user edits back to PrestaShop. Only the editable product fields the
  // frontend actually changed are accepted (per-product deltas); unknown or
  // non-string fields are dropped so nothing else can be written to the shop.
  router.post(
    '/fetch/prestashop/save',
    requireAuth,
    wrap(async (req, res) => {
      const prestashop = req.store!.config.prestashop;
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
        const images = fields.images;
        delete fields.images;
        const imagesToDelete: string[] = Array.isArray((rawFields as Record<string, unknown>).images_to_delete)
          ? ((rawFields as Record<string, unknown>).images_to_delete as string[]).filter((id): id is string => typeof id === 'string')
          : [];
        const hasTextFields = Object.keys(fields).length > 0;
        const hasImages = Array.isArray(images) && images.length > 0;
        const hasDeletions = imagesToDelete.length > 0;

        if (!hasTextFields && !hasImages && !hasDeletions) {
          results[productId] = false;
          failures.push(`no editable fields for product ${productId}`);
          continue;
        }
        try {
          if (hasTextFields) {
            await client.updateProduct(productId, fields);
          }
          let imageFailCount = 0;
          if (hasDeletions) {
            for (const imageId of imagesToDelete) {
              try {
                await client.deleteProductImage(productId, imageId);
              } catch (delError) {
                imageFailCount += 1;
                const msg = translatePrestashopError(delError, 'PrestaShop');
                logger.error('Failed to delete product image', {
                  productId,
                  imageId,
                  error: delError instanceof Error ? delError.message : String(delError)
                });
                failures.push(msg);
              }
            }
          }
          if (hasImages) {
            for (const img of images!) {
              try {
                const buffer = Buffer.from(img.data, 'base64');
                await client.uploadProductImage(productId, buffer, img.content_type);
              } catch (imgError) {
                imageFailCount += 1;
                const msg = translatePrestashopError(imgError, 'PrestaShop');
                logger.error('Failed to upload product image', {
                  productId,
                  error: imgError instanceof Error ? imgError.message : String(imgError)
                });
                failures.push(msg);
              }
            }
          }
          const totalImageOps = imagesToDelete.length + (images?.length ?? 0);
          const allImagesFailed = totalImageOps > 0 && imageFailCount === totalImageOps;
          results[productId] = !allImagesFailed;
          if (!allImagesFailed) saved += 1;
        } catch (error) {
          const msg = translatePrestashopError(error, 'PrestaShop');
          logger.error('Failed to update PrestaShop product', {
            productId,
            error: error instanceof Error ? error.message : String(error)
          });
          results[productId] = false;
          failures.push(msg);
        }
      }

      if (saved === 0) {
        const reason = Array.from(new Set(failures))[0];
        throw new AppError(
          reason
            ? `No se pudo guardar ningún producto en PrestaShop: ${reason}`
            : 'No se pudo guardar ningún producto en PrestaShop',
          400
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
  if (Array.isArray(source.images) && source.images.every((img): img is { data: string; content_type: string } =>
    typeof img === 'object' && img !== null && typeof img.data === 'string' && typeof img.content_type === 'string'
  )) {
    result.images = source.images;
  }
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
