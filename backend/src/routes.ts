// API routes for Catalog AI.
// Wires the frontend contract to the processing modules and an in-memory store.

import { NextFunction, Request, Response, Router } from 'express';
import { AppError } from './utils/error-handler';
import { maskSecret } from './utils/mask';
import { logger } from './utils/logger';
import { generateRequestId, getAIProviderBaseUrl } from './modules/ai-text-suggester/ai-text-suggester';
import { getLogContext, withLogContext } from './utils/log-context';
import { DEFAULT_AI_PROMPTS } from './modules/ai-text-suggester/default-prompts';
import { searchProductImages } from './modules/image-providers/services/engine';
import { ImageSearcher } from './modules/image-providers/types';
import imageProvidersRouter from './modules/image-providers/router';
import autocompleteQuotaRouter from './modules/autocomplete-quota/router';
import aiProvidersRouter from './modules/ai-config/router';
import marketplacesRouter from './modules/marketplaces/router';
import apiKeysRouter from './modules/api-keys/router';
import { runAutocomplete } from './modules/autocomplete/autocomplete-service';
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
import { listAllMarketplaces, findGlobalMarketplaceByName } from './modules/auth/database';

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
  // `requireEnabled` is false only for the read-only routes that just serve the
  // dataset already imported: that content stays visible after the super admin
  // switches the marketplace off.
  function requireMarketplace(
    req: Request,
    action: string,
    options: { requireEnabled?: boolean } = {}
  ): { name: RegisteredMarketplace; label: string } {
    const name = parseMarketplaceSlug(req.params.marketplace);
    if (!name) throw new AppError(`Marketplace desconocido: ${req.params.marketplace}`, 404);
    if (options.requireEnabled !== false) requireMarketplaceEnabled(name);
    if (!isMarketplaceConfigured(name, req.store!.config)) {
      throw new AppError(`${getMarketplaceLabel(name)} must be configured to ${action} products`, 400);
    }
    return { name, label: getMarketplaceLabel(name) };
  }

  // A marketplace disabled platform-wide by the super admin is off-limits for
  // every comercio, even for those that still had it selected before the
  // switch: they must pick another marketplace or contact the administrator.
  // Only the operations that talk to the shop are blocked; reading or
  // discarding the dataset already imported stays available.
  function requireMarketplaceEnabled(name: RegisteredMarketplace): void {
    const global = findGlobalMarketplaceByName(name);
    if (global && global.enabled !== 1) {
      throw new AppError(
        `El marketplace ${getMarketplaceLabel(name)} está desactivado por el administrador de la aplicación`,
        403
      );
    }
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
      active_marketplace: config.active_marketplace,
      marketplaces: listAllMarketplaces().map((row) => ({
        name: row.name,
        label: getMarketplaceLabel(row.name as RegisteredMarketplace),
        enabled: row.enabled === 1
      }))
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
    // Mock); unknown names are ignored instead of corrupting the config. A
    // marketplace disabled platform-wide by the super admin cannot be selected.
    if (isRegisteredMarketplace(body.active_marketplace)) {
      const target = findGlobalMarketplaceByName(body.active_marketplace);
      if (target && target.enabled !== 1) {
        throw new AppError(`El marketplace ${body.active_marketplace} está desactivado`, 403);
      }
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
      requireMarketplaceEnabled(name);

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
  // text fields of one product, plus the missing product images. The whole
  // exchange (AI, image search, quota and audit) lives in `runAutocomplete`, the
  // single source of truth shared with the public API, so both callers keep the
  // exact same behaviour and response shape.
  router.post(
    '/autocomplete',
    requireAuth,
    wrap(async (req, res) => {
      const origin = `${req.protocol}://${req.get('host')}`;
      // One correlation id for the whole exchange (AI call plus image search), so
      // the logs of both stay linked together. Reuse the HTTP request nonce if present.
      const requestId = (req as any).requestId || getLogContext().requestId || generateRequestId();
      if ((req as any).requestId || getLogContext().requestId) {
        withLogContext({ ...getLogContext(), requestId }, () => {});
      }

      const data = await runAutocomplete({
        product: (req.body ?? {}).product as ProductData,
        language: req.body?.language,
        ai: req.store!.config.ai,
        searchImages,
        comercioId: req.user?.comercio_id,
        userId: req.user?.sub,
        comercioName: req.user?.username,
        origin,
        requestId
      });

      res.json({ success: true, data });
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
          limit: 50
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
  // never reach the browser. Read-only: the images already imported keep being
  // served even after the super admin switches the marketplace off.
  router.get(
    '/fetch/:marketplace/images/:productId/:imageId',
    requireAuth,
    wrap(async (req, res) => {
      const { name, label } = requireMarketplace(req, 'fetch', { requireEnabled: false });
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

  // Super admin: platform-wide marketplace enable/disable switch
  router.use('/superadmin/marketplaces', requireAuth, requireRole('superadmin'), marketplacesRouter);

  // Super admin: per-comercio autocomplete quota and its audit report
  router.use('/superadmin/autocomplete-quota', requireAuth, requireRole('superadmin'), autocompleteQuotaRouter);

  // Super admin: comercio API keys for the public (machine-to-machine) API
  router.use('/superadmin/comercios', requireAuth, requireRole('superadmin'), apiKeysRouter);

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
