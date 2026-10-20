// API routes for Catalog AI.
// Wires the frontend contract to the processing modules and an in-memory store.

import { NextFunction, Request, Response, Router } from 'express';
import { AppError } from './utils/error-handler';
import { maskSecret } from './utils/mask';
import { logger } from './utils/logger';
import { AITextSuggester, generateRequestId, getAIProviderBaseUrl } from './modules/ai-text-suggester/ai-text-suggester';
import { getLogContext, withLogContext } from './utils/log-context';
import { DEFAULT_AI_PROMPTS } from './modules/ai-text-suggester/default-prompts';
import {
  buildCompletionResponseInstructions,
  AUTOCOMPLETE_FIELDS,
  extractCompletionProposals,
  fillPrompt,
  isValidCompletionStatus,
  parseCompletionResponse
} from './modules/ai-text-suggester/autocomplete';
import { searchProductImages, MAX_AUTOCOMPLETE_IMAGES } from './modules/image-providers/services/engine';
import { ImageSearcher } from './modules/image-providers/types';
import imageProvidersRouter from './modules/image-providers/router';
import autocompleteQuotaRouter from './modules/autocomplete-quota/router';
import aiProvidersRouter from './modules/ai-config/router';
import { resolveActiveProviderOrThrow, translateAIError } from './modules/ai-config/global-ai';
import {
  recordAutocompleteAudit,
  releaseAutocompleteCall,
  reserveAutocompleteCall
} from './modules/autocomplete-quota/quota';
import { AIProviderName, AIProviderSettings, ProductData } from './types';
import { CatalogConfig } from './store';
import { requireAuth, requireRole } from './modules/auth/middleware';
import {
  createTestAdapter,
  getMarketplaceLabel,
  isMarketplaceConfigured,
  isRegisteredMarketplace,
  MarketplaceResolver,
  MarketplaceTestAdapterFactory,
  parseMarketplaceSlug,
  resolveMarketplace
} from './modules/marketplaces/adapters/registry';
import { translateMarketplaceError } from './modules/marketplaces/adapters/errors';
import { RegisteredMarketplace } from './modules/marketplaces/adapters/types';

// The marketplace layer is injected so the core never builds an adapter itself;
// app.ts (the composition root) binds the real registry and the test client
// factories. The defaults fall back to the registry with no extra context.
export interface RouteDependencies {
  resolveMarketplace?: MarketplaceResolver;
  createTestAdapter?: MarketplaceTestAdapterFactory;
  imageSearcher?: ImageSearcher;
}

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

const wrap = (fn: AsyncHandler) => (req: Request, res: Response, next: NextFunction): void => {
  fn(req, res, next).catch(next);
};

// Flat AI provider keys a comercio is NEVER allowed to change through /config:
// the provider setup is global and owned by the super admin.
const AI_PROVIDER_SETTING_KEYS = [
  'provider',
  'providers',
  'api_key',
  'model',
  'base_url',
  'language',
  'timeout',
  'concurrency',
  'temperature',
  'web_search'
] as const;

// Copy of the configuration that is safe to send to the client. Every stored
// credential (the AI provider keys, the PrestaShop API key and the Shopify
// access token) is replaced by an empty value plus a `has_api_key` flag and a
// masked `api_key_hint`, so a saved secret stays recognisable to the operator
// without ever being exposed to the browser. Used by both GET and PUT /config
// so a save response can never leak a key back to the caller.
function maskConfiguration(config: CatalogConfig) {
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
  const prestashop = config.prestashop
    ? {
        ...config.prestashop,
        api_key: '',
        has_api_key: Boolean(config.prestashop.api_key),
        api_key_hint: maskSecret(config.prestashop.api_key)
      }
    : config.prestashop;
  const shopify = config.shopify
    ? {
        ...config.shopify,
        access_token: '',
        has_api_key: Boolean(config.shopify.access_token),
        api_key_hint: maskSecret(config.shopify.access_token)
      }
    : config.shopify;
  return { ai: aiConfig, prestashop, shopify };
}

export function createApiRouter(deps: RouteDependencies): Router {
  const router = Router();

  // Marketplace resolution. Bound by app.ts so the test client factories reach
  // the adapters; the defaults just call the registry with no extra context.
  const resolveMkt: MarketplaceResolver =
    deps.resolveMarketplace ?? ((name, config, store) => resolveMarketplace(name, config, store));
  const createTest: MarketplaceTestAdapterFactory =
    deps.createTestAdapter ?? ((name, body, config, store) => createTestAdapter(name, body, config, store));

  // Image search port. Bound by app.ts so the core never imports the engine's
  // persistence; the default calls the engine with its database-backed repo.
  const searchImages: ImageSearcher = deps.imageSearcher ?? searchProductImages;

  // Resolves the `:marketplace` URL segment to a registered marketplace and
  // ensures it has credentials saved. Every fetch/save/image route funnels
  // through this, so the core never branches on a concrete platform.
  function requireMarketplace(req: Request, action: string): { name: RegisteredMarketplace; label: string } {
    const name = parseMarketplaceSlug(req.params.marketplace);
    if (!name) throw new AppError(`Marketplace desconocido: ${req.params.marketplace}`, 404);
    if (!isMarketplaceConfigured(name, req.store!.config)) {
      throw new AppError(`${getMarketplaceLabel(name)} must be configured to ${action} products`, 400);
    }
    return { name, label: getMarketplaceLabel(name) };
  }

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
    const { ai, prestashop, shopify } = maskConfiguration(config);
    res.json({
      success: true,
      prestashop,
      shopify,
      ai: ai ? { ...ai, base_url: getAIProviderBaseUrl(req.store!.config.ai) } : ai,
      active_marketplace: config.active_marketplace
    });
  });

  // Config write and test endpoints require auth; config mutation requires admin
  router.put('/config', requireAuth, requireRole('admin', 'user'), (req, res) => {
    const body = req.body ?? {};
    const next = { ...req.store!.config };

    // Users with role "user" may only customize the prompt; admins may also
    // change the PrestaShop credentials. Neither can touch the AI provider
    // configuration, which is global and owned by the super admin.
    if (req.user!.role === 'user') {
      const allowedTopKeys = ['ai'];
      const disallowed = Object.keys(body).filter((k) => !allowedTopKeys.includes(k));
      if (disallowed.length > 0) {
        throw new AppError('Insufficient permissions to modify configuration: ' + disallowed.join(', '), 403);
      }
      if (body.ai) {
        const allowedAiKeys = ['default_prompt'];
        const aiKeys = Object.keys(body.ai);
        const disallowedAi = aiKeys.filter((k) => !allowedAiKeys.includes(k));
        if (disallowedAi.length > 0) {
          throw new AppError('Insufficient permissions to modify AI settings: ' + disallowedAi.join(', '), 403);
        }
      }
    }

    // The AI provider configuration is global: any attempt to change it from a
    // comercio is rejected instead of being silently ignored.
    if (body.ai) {
      const attempted = Object.keys(body.ai).filter((k) => (AI_PROVIDER_SETTING_KEYS as readonly string[]).includes(k));
      if (attempted.length > 0) {
        throw new AppError(
          'La configuración de proveedores de IA es global y solo la gestiona el administrador de la aplicación: ' +
            attempted.join(', '),
          403
        );
      }
    }

    // PrestaShop: preserve API key if the frontend sent an empty placeholder.
    // Credentials are trimmed so a copy/paste with a trailing space or newline
    // cannot break the Basic authentication (the secret is stored exactly as it
    // will be sent to the webservice).
    if (body.prestashop) {
      const psUpdate = { ...body.prestashop };
      if (typeof psUpdate.api_key === 'string') {
        psUpdate.api_key = psUpdate.api_key.trim();
      }
      if (!psUpdate.api_key) {
        delete psUpdate.api_key;
      }
      next.prestashop = { ...next.prestashop, ...psUpdate };
    }

    // Shopify: same treatment for the Admin API access token.
    if (body.shopify) {
      const shopUpdate = { ...body.shopify };
      if (typeof shopUpdate.access_token === 'string') {
        shopUpdate.access_token = shopUpdate.access_token.trim();
      }
      if (!shopUpdate.access_token) {
        delete shopUpdate.access_token;
      }
      next.shopify = { ...next.shopify, ...shopUpdate };
    }

    // Active marketplace: any value the registry knows (including the demo
    // Mock); unknown names are ignored instead of corrupting the config.
    if (isRegisteredMarketplace(body.active_marketplace)) {
      next.active_marketplace = body.active_marketplace;
    }

    // The only AI settings a comercio owns are the prompt and the enabled
    // fields; the provider settings were rejected above.
    if (body.ai) {
      if (Array.isArray(body.ai.enabled_fields)) {
        next.ai = { ...next.ai, enabled_fields: body.ai.enabled_fields };
      }
      if (body.ai.default_prompt !== undefined) {
        next.ai = { ...next.ai, default_prompt: body.ai.default_prompt };
      }
    }

    req.store!.config = next;
    req.configPersistence?.save(next);
    // Respond with what is really persisted, not with the in-memory copy: if the
    // comercio has no marketplace row the save is a no-op, and the caller must
    // see that instead of a success message with the unsaved credentials. The
    // response is masked like GET /config, so it never returns a stored secret.
    const persisted = req.configPersistence?.load();
    if (persisted) {
      req.store!.config = persisted;
    }
    const { ai, prestashop, shopify } = maskConfiguration(req.store!.config);
    res.json({
      success: true,
      message: 'Configuration saved',
      ai,
      prestashop,
      shopify,
      active_marketplace: req.store!.config.active_marketplace
    });
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

  // Tests a marketplace connection against a CANDIDATE config assembled from
  // the request body (falling back to the saved credentials). The registry
  // builds the right per-marketplace config and adapter, so this one route
  // serves every marketplace.
  router.post(
    '/config/test/:marketplace',
    requireAuth,
    wrap(async (req, res) => {
      const name = parseMarketplaceSlug(req.params.marketplace);
      if (!name) throw new AppError(`Marketplace desconocido: ${req.params.marketplace}`, 404);

      const { adapter, label } = createTest(name, req.body ?? {}, req.store!.config, req.store!);
      try {
        await adapter.testConnection();
      } catch (error) {
        // testConnection reports its failures as errors (HTML page instead of
        // the API, invalid key, unreachable host...), so the specific reason is
        // translated to the admin instead of a generic "could not connect".
        throw new AppError(translateMarketplaceError(error, label), 400);
      }

      res.json({ success: true, message: `Conexión con ${label} correcta` });
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

      // AI is global and configured by the super admin. Fail fast (before any
      // quota is reserved or a provider is called) when nothing usable is
      // configured, with a message that points the comercio to the admin.
      const effectiveAI = resolveActiveProviderOrThrow(req.store!.config.ai);

      const language =
        body.language === 'es' || body.language === 'en'
          ? body.language
          : effectiveAI.language === 'en'
            ? 'en'
            : 'es';
      const promptSource = effectiveAI.default_prompt?.trim() || DEFAULT_AI_PROMPTS[language] || DEFAULT_AI_PROMPTS.en;

      const suggester = new AITextSuggester(effectiveAI);

      const origin = `${req.protocol}://${req.get('host')}`;
      // One correlation id for the whole exchange (AI call plus image search),
      // so the logs of both stay linked together. Reuse the HTTP request nonce if present.
      const requestId = (req as any).requestId || getLogContext().requestId || generateRequestId();
      if ((req as any).requestId || getLogContext().requestId) {
        withLogContext({ ...getLogContext(), requestId }, () => {});
      }
      const reference = product.reference ?? '';
      const brand = product.brand ?? '';
      const ean = product.ean ?? '';


      // The AI is only asked about the autocomplete fields that are still empty
      // (the product may have come with some of them already filled), so it
      // never proposes values for text that is already there.
      const missingFields = AUTOCOMPLETE_FIELDS.filter((field) => {
        const value = product[field as keyof ProductData];
        return typeof value !== 'string' || value.trim() === '';
      });

      // Per-comercio quota, checked BEFORE any provider is called so a request
      // over the limit costs nothing: no AI call, no image search. The check
      // takes the slot atomically, which is what keeps several users of the same
      // comercio from overshooting the limit at the same time.
      //
      // Nothing is reserved when the AI is not going to be asked (the product
      // already has every field), because no provider call happens and a slot
      // taken for a call that never occurs would be a call the comercio never
      // made. The super admin has no comercio (comercio_id 0) and does not pay
      // any quota: it is the operator configuring and testing the providers.
      const userComercioId = req.user?.comercio_id;
      const quotaComercioId =
        typeof userComercioId === 'number' && userComercioId > 0 && missingFields.length > 0 ? userComercioId : null;
      let reservation: { comercioId: number; cycleStart: string } | null = null;
      if (quotaComercioId !== null) {
        const decision = reserveAutocompleteCall(quotaComercioId);
        if (!decision.allowed) {
          logger.info('Autocomplete blocked by quota', {
            requestId,
            comercioId: quotaComercioId,
            reason: decision.reason,
            used: decision.used,
            limit: decision.limit,
            reference
          });
          throw new AppError(
            decision.reason === 'disabled'
              ? 'AI autocomplete is not enabled for your account. Contact the administrator.'
              : 'AI autocomplete limit reached for the current billing period.',
            429,
            {
              reason: decision.reason,
              limit: decision.limit,
              used: decision.used,
              remaining: decision.remaining
            },
            'autocomplete_quota_exceeded'
          );
        }
        // Remembered so the slot can be refunded if the AI ends up not
        // answering with a valid JSON (see the release call below).
        reservation = { comercioId: quotaComercioId, cycleStart: decision.cycleStart ?? '' };
      }

      // The brand/reference/EAN image search only runs when the product still
      // has image slots free; a fully illustrated product skips the call.
      const existingImageCount = Array.isArray(product.images) ? product.images.length : 0;
      const freeImageSlots = Math.max(0, MAX_AUTOCOMPLETE_IMAGES - existingImageCount);
      const willSearchImages = freeImageSlots > 0;

      // AI and image search are independent, so both run in parallel and the
      // product only waits for the slowest of the two. When a call is skipped
      // (nothing to fill / no slot left) the reason is logged so the decision
      // is always traceable. Each branch also isolates its OWN failures: an
      // error or timeout in the AI call never cancels the image search, and an
      // error or timeout in the image search never cancels the AI proposals.
      const [aiOutcome, imageOutcome] = await Promise.all([
        (async () => {
          if (missingFields.length === 0) {
            logger.info('AI autocomplete skipped', {
              requestId,
              reference,
              reason: 'El producto ya tiene los 4 campos de texto (description, description_short, meta_title, meta_description)'
            });
            return { status: 'ok', confidence: null, warnings: [], proposals: {}, ai_error: null };
          }
          try {
            logger.info('AI autocomplete request', { requestId, reference, provider: effectiveAI.provider, fields: missingFields });
            const message = `${fillPrompt(promptSource, product)}\n\n${buildCompletionResponseInstructions(language, missingFields)}`;

            let raw: string;
            try {
              raw = await suggester.complete({ prompt: message, product, fields: missingFields, requestId });
            } catch (error) {
              // The AI call failed: do not fail the whole request. The image
              // search still runs and its results are returned, so the product
              // can get images even without the AI-generated descriptions.
              logger.warn(`AI autocomplete falló para ${reference}: ${translateAIError(error, effectiveAI.provider)}`, { requestId });
              return { status: 'error', confidence: null, warnings: [], proposals: {}, ai_error: translateAIError(error, effectiveAI.provider) };
            }

            let parsed: any;
            try {
              parsed = parseCompletionResponse(raw);
            } catch {
              logger.warn(`AI autocomplete devolvió JSON inválido para ${reference}`, { requestId });
              return {
                status: 'error',
                confidence: null,
                warnings: [],
                proposals: {},
                ai_error: 'The AI response was not valid JSON matching the expected structure'
              };
            }

            return {
              status: typeof parsed.status === 'string' ? parsed.status : 'unknown',
              confidence: typeof parsed.confidence === 'number' ? parsed.confidence : null,
              warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
              proposals: extractCompletionProposals(parsed, missingFields),
              ai_error: null
            };
          } catch (error) {
            // Last-resort guard: everything above (prompt building included)
            // lives inside this try, so an unexpected failure preparing the AI
            // exchange can never reject this branch and cancel the image search.
            logger.error(`AI autocomplete error inesperado para ${reference}`, { requestId, error: error instanceof Error ? error.message : String(error) });
            return { status: 'error', confidence: null, warnings: [], proposals: {}, ai_error: error instanceof Error ? error.message : String(error) };
          }
        })(),
        (async (): Promise<{ urls: string[]; source: string | null }> => {
          try {
            if (!willSearchImages) {
              logger.info('Image search skipped', {
                requestId,
                reference,
                reason: `El producto ya tiene ${existingImageCount} imágenes (máximo ${MAX_AUTOCOMPLETE_IMAGES})`
              });
              return { urls: [], source: null };
            }
            // Product images come from the image provider services configured
            // by the super admin (feeds first, then round-robin providers). The
            // AI is never asked for image URLs, so no invented URL can reach
            // the frontend. Only the remaining free slots are requested.
            const outcome = await searchImages({
              brand,
              reference,
              ean,
              origin,
              maxResults: freeImageSlots,
              comercioId: req.user?.comercio_id,
              comercioName: req.user?.username,
              requestId
            });
            if (outcome.attempts.length > 0) {
              logger.debug(`Búsqueda de imágenes para ${reference}`, { requestId, attempts: outcome.attempts });
            }
            return { urls: outcome.urls, source: outcome.source };
          } catch (error) {
            // The image search failed (a provider timed out, none is enabled,
            // ...): it must never cancel the AI proposals, so the product keeps
            // the AI-generated text and simply ends with no new images.
            logger.warn(`No se pudieron obtener imágenes para ${reference}: ${error instanceof Error ? error.message : String(error)}`, {
              requestId
            });
            return { urls: [], source: null };
          }
        })()
      ]);

      // Settles the quota slot taken above now that the AI call has finished:
      //
      //  - valid JSON with a status of the contract -> the slot is consumed and
      //    an audit row is written, so the counter only ever counts answers the
      //    comercio can prove it got.
      //  - anything else (provider error, unparseable JSON, a status outside
      //    the contract) -> the slot is refunded, because no usable answer was
      //    produced for it.
      //
      // The image search does not affect the counter: the limit is on AI calls.
      if (reservation) {
        if (isValidCompletionStatus(aiOutcome.status)) {
          recordAutocompleteAudit({
            comercioId: reservation.comercioId,
            userId: req.user?.sub ?? 0,
            providerName: effectiveAI.provider,
            status: aiOutcome.status,
            brand,
            reference,
            ean
          });
        } else {
          if (aiOutcome.status !== 'error') {
            logger.info('AI autocomplete devolvió un status fuera del contrato, no se consume cuota', {
              requestId,
              comercioId: reservation.comercioId,
              reference,
              status: String(aiOutcome.status)
            });
          }
          if (reservation.cycleStart) {
            releaseAutocompleteCall(reservation.comercioId, reservation.cycleStart);
          }
        }
      }

      res.json({
        success: true,
        data: {
          reference,
          status: aiOutcome.status,
          confidence: aiOutcome.confidence,
          warnings: aiOutcome.warnings,
          proposals: aiOutcome.proposals,
          ai_error: aiOutcome.ai_error ?? null,
          image_urls: imageOutcome.urls,
          image_source: imageOutcome.source
        }
      });
    })
  );

  // Marketplace fetch: builds a working dataset straight from the resolved
  // marketplace (by reference and/or brand, with optional filters) as the data
  // source for the import. One route serves every marketplace.
  router.post(
    '/fetch/:marketplace',
    requireAuth,
    wrap(async (req, res) => {
      const { name, label } = requireMarketplace(req, 'fetch');
      const adapter = resolveMkt(name, req.store!.config, req.store!);

      const body = req.body ?? {};
      const references = Array.isArray(body.references) ? (body.references as string[]) : [];
      const normalizedReferences = references.map((reference) => String(reference).trim()).filter(Boolean);

      let result;
      try {
        result = await adapter.fetch({
          references: normalizedReferences,
          brand: typeof body.brand === 'string' ? body.brand : '',
          description: body.description === 'with' || body.description === 'without' ? body.description : 'all',
          images: body.images === 'with' || body.images === 'without' ? body.images : 'all',
          filter_operator: body.filter_operator === 'or' ? 'or' : 'and',
          limit: name === 'Shopify' ? 250 : 50
        });
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw new AppError(translateMarketplaceError(error, label), 400);
      }

      if (result.products.length === 0) {
        throw new AppError('No products matched the given criteria', 404);
      }

      res.json({
        success: true,
        message: `${result.total} product(s) fetched from ${label}`,
        data: {
          data_id: result.dataId,
          products: result.products,
          summary: { total: result.total }
        }
      });
    })
  );

  // Returns the working dataset currently held for a marketplace (null before
  // anything has been fetched). Reads never require configured credentials.
  router.get('/fetch/:marketplace', requireAuth, (req, res) => {
    const name = parseMarketplaceSlug(req.params.marketplace);
    if (!name) throw new AppError(`Marketplace desconocido: ${req.params.marketplace}`, 404);
    const dataset = resolveMkt(name, req.store!.config, req.store!).getDataset();
    res.json({
      success: true,
      data: dataset
        ? { data_id: dataset.dataId, products: dataset.products, summary: { total: dataset.total } }
        : null
    });
  });

  // Discards the working dataset held for a marketplace.
  router.delete('/fetch/:marketplace', requireAuth, (req, res) => {
    const name = parseMarketplaceSlug(req.params.marketplace);
    if (!name) throw new AppError(`Marketplace desconocido: ${req.params.marketplace}`, 404);
    resolveMkt(name, req.store!.config, req.store!).clearDataset();
    res.json({ success: true, message: `${getMarketplaceLabel(name)} data discarded` });
  });

  // Proxies a product image from the resolved marketplace as raw bytes. The
  // dataset stores images as backend-relative paths so the shop's credentials
  // never reach the browser.
  router.get(
    '/fetch/:marketplace/images/:productId/:imageId',
    requireAuth,
    wrap(async (req, res) => {
      const { name, label } = requireMarketplace(req, 'fetch');
      const { productId, imageId } = req.params;
      const adapter = resolveMkt(name, req.store!.config, req.store!);

      let buffer: Buffer;
      try {
        buffer = await adapter.proxyImage(productId, imageId);
      } catch {
        throw new AppError(`${label} image not found`, 404);
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

  // Deletes a product image from the resolved marketplace.
  router.delete(
    '/fetch/:marketplace/images/:productId/:imageId',
    requireAuth,
    wrap(async (req, res) => {
      const { name, label } = requireMarketplace(req, 'delete images from');
      const { productId, imageId } = req.params;
      const adapter = resolveMkt(name, req.store!.config, req.store!);
      try {
        await adapter.deleteImage(productId, imageId);
        res.json({ success: true, message: 'Image deleted' });
      } catch (error) {
        throw new AppError(translateMarketplaceError(error, label), 400);
      }
    })
  );

  // Pushes user edits back to the resolved marketplace. Only the editable
  // product fields the frontend actually changed are accepted (per-product
  // deltas); unknown or non-string fields are dropped so nothing else can be
  // written to the shop. The adapter owns the platform-specific mapping.
  router.post(
    '/fetch/:marketplace/save',
    requireAuth,
    wrap(async (req, res) => {
      const { name, label } = requireMarketplace(req, 'save');
      const adapter = resolveMkt(name, req.store!.config, req.store!);

      const updates = (req.body ?? {}).updates;
      if (!updates || typeof updates !== 'object' || Array.isArray(updates) || Object.keys(updates).length === 0) {
        throw new AppError('No product updates were provided', 400);
      }

      const entries = Object.entries(updates as Record<string, unknown>);
      let result;
      try {
        result = await adapter.saveUpdates(updates as Record<string, unknown>);
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw new AppError(translateMarketplaceError(error, label), 400);
      }

      const saved = result.successCount;
      const failed = entries.length - saved;

      if (saved === 0) {
        const reason = Array.from(new Set(result.failures))[0];
        throw new AppError(
          reason
            ? `No se pudo guardar ningún producto en ${label}: ${reason}`
            : `No se pudo guardar ningún producto en ${label}`,
          400
        );
      }

      res.json({
        success: true,
        message: `${saved} of ${entries.length} product(s) updated in ${label}`,
        data: { saved, failed, results: result.results }
      });
    })
  );

  // Super admin: image provider services management
  router.use('/superadmin/image-providers', requireAuth, requireRole('superadmin'), imageProvidersRouter);

  // Super admin: global AI provider configuration
  router.use('/superadmin/ai-providers', requireAuth, requireRole('superadmin'), aiProvidersRouter);

  // Super admin: per-comercio autocomplete quota and its audit report
  router.use('/superadmin/autocomplete-quota', requireAuth, requireRole('superadmin'), autocompleteQuotaRouter);

  return router;
}

// Detects the image format from its magic bytes so the proxy can send the right
// Content-Type (marketplaces store product images as PNG, JPEG, GIF or WebP).
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
