// API routes for Catalog AI.
// Wires the frontend contract to the processing modules and an in-memory store.

import { NextFunction, Request, Response, Router } from 'express';
import { AppError } from './utils/error-handler';
import { DataStore } from './store';
import { AITextSuggester } from './modules/ai-text-suggester/ai-text-suggester';
import { PrestaShopClient } from './modules/prestashop-client/prestashop-client';
import { PrestaShopFetcher, PRESTASHOP_FETCH_LIMIT } from './modules/prestashop-fetcher/prestashop-fetcher';
import { ConfigPersistence } from './modules/config-persistence/config-persistence';
import { AIConfig, PrestaShopConfig, ProductData } from './types';

export interface RouteDependencies {
  store: DataStore;
  prestashopClientFactory?: (config: PrestaShopConfig) => PrestaShopClient;
  configPersistence?: ConfigPersistence;
}

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

const wrap = (fn: AsyncHandler) => (req: Request, res: Response, next: NextFunction): void => {
  fn(req, res, next).catch(next);
};

function buildAIConfig(store: DataStore, body: any): AIConfig {
  return {
    ...store.config.ai,
    ...body,
    enabled_fields: Array.isArray(body?.enabled_fields) ? body.enabled_fields : store.config.ai.enabled_fields
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
    res.json({ success: true, ...store.config });
  });

  router.put('/config', (req, res) => {
    const body = req.body ?? {};
    const next = { ...store.config };

    if (body.prestashop) next.prestashop = { ...next.prestashop, ...body.prestashop };
    if (body.ai) next.ai = { ...next.ai, ...body.ai };

    store.config = next;
    deps.configPersistence?.save(next);
    res.json({ success: true, message: 'Configuration saved', ...store.config });
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
      if (!Array.isArray(suggestions)) throw new AppError('AI connection test failed', 400);

      res.json({ success: true, message: 'AI connection successful' });
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

  return router;
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
