// Super admin routes for the global AI provider configuration: list/configure
// every provider, pick the active one and test a connection. This is the ONLY
// place the AI provider settings can be changed; comercios just consume them.

import { NextFunction, Request, Response, Router } from 'express';
import { AppError } from '../../utils/error-handler';
import { logger } from '../../utils/logger';
import { requireAuth, requireRole } from '../auth/middleware';
import {
  findAIProviderByName,
  getAIProviderConfig,
  setAIProviderConfigBatch,
  setAIProviderEnabled,
  setGlobalSetting,
  listAIProviders
} from '../auth/database';
import { AITextSuggester, getAIProviderBaseUrl } from '../ai-text-suggester/ai-text-suggester';
import {
  GLOBAL_AI_PROVIDER_NAMES,
  PROVIDER_LABELS,
  loadGlobalAIConfig,
  normalizeConcurrency,
  normalizeTimeoutSeconds,
  translateAIError
} from './global-ai';
import { AIConfig, AIProviderName, AIProviderSettings } from '../../types';

const router = Router();

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

const wrap = (fn: AsyncHandler) => (req: Request, res: Response, next: NextFunction): void => {
  fn(req, res, next).catch(next);
};

const FLAT_SETTING_KEYS = ['model', 'language', 'base_url'] as const;

// Public shape of a provider: the API key value is NEVER exposed, only a
// has_api_key flag so the UI knows who is configured. The mock provider stores
// no credentials, so it is always reported as configured.
function toPublicProvider(row: { id: number; name: string; enabled: number }, activeProvider: AIProviderName) {
  const cfg = getAIProviderConfig(row.id);
  const name = row.name as AIProviderName;
  return {
    name,
    label: PROVIDER_LABELS[row.name] ?? row.name,
    enabled: row.enabled === 1,
    is_active: name === activeProvider,
    has_api_key: Boolean(cfg.api_key),
    configured: name === 'mock' || Boolean(cfg.api_key),
    model: cfg.model ?? null,
    base_url: cfg.base_url ?? null,
    language: cfg.language ?? null,
    temperature: cfg.temperature ? Number(cfg.temperature) : null,
    timeout: cfg.timeout ? Number(cfg.timeout) : null,
    concurrency: cfg.concurrency ? Number(cfg.concurrency) : null,
    web_search: cfg.web_search === 'true'
  };
}

router.get('/', requireAuth, requireRole('superadmin'), (_req: Request, res: Response) => {
  const activeProvider = (loadGlobalAIConfig().provider ?? 'mock') as AIProviderName;
  res.json({ success: true, data: listAIProviders().map((row) => toPublicProvider(row, activeProvider)) });
});

// Sets the active provider for the whole application. The provider must exist;
// the mock provider is allowed (it is the test fixture), and the response
// reports whether it is actually usable so the UI can warn about it.
router.put('/active', requireAuth, requireRole('superadmin'), (req: Request, res: Response) => {
  const provider = String(req.body?.provider ?? '');
  if (!GLOBAL_AI_PROVIDER_NAMES.includes(provider as AIProviderName)) {
    throw new AppError('Unknown AI provider', 400);
  }
  if (!findAIProviderByName(provider)) {
    throw new AppError('AI provider not found', 404);
  }
  setGlobalSetting('active_ai_provider', provider);
  const ai = loadGlobalAIConfig();
  const usable = ai.provider !== 'mock' && Boolean(ai.api_key);
  res.json({
    success: true,
    message: usable ? `Proveedor activo: ${provider}` : `Proveedor activo: ${provider} (sin configurar)`,
    data: { provider, usable }
  });
});

// Tests a provider connection from the draft settings the form is about to
// save: the stored settings plus the fields currently being edited, so a bad
// key or URL is caught before it is persisted.
router.post('/test', requireAuth, requireRole('superadmin'), wrap(async (req, res) => {
  const body = req.body ?? {};
  const storedGlobal = loadGlobalAIConfig();
  const provider = (body.provider ?? storedGlobal.provider ?? 'mock') as AIProviderName;
  const stored: AIProviderSettings = { ...(storedGlobal.providers?.[provider] ?? {}) };
  const flat: AIProviderSettings = {};
  for (const key of FLAT_SETTING_KEYS) {
    if (body?.[key] !== undefined && body[key] !== '') (flat as Record<string, unknown>)[key] = body[key];
  }
  const timeout = normalizeTimeoutSeconds(body?.timeout);
  const config: AIConfig = {
    provider,
    ...stored,
    ...flat,
    ...(timeout !== undefined ? { timeout } : {}),
    ...(body?.api_key ? { api_key: body.api_key } : {}),
    enabled_fields: storedGlobal.enabled_fields
  };

  const suggester = new AITextSuggester(config);
  const baseUrl = getAIProviderBaseUrl(config);
  logger.info('AI connection test', { provider: config.provider, model: config.model ?? '', baseUrl });

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
}));

// Updates one provider: model, language, base URL, timeout, concurrency,
// temperature, web search, API key and the global enabled flag. An empty API
// key means "keep the stored one"; an explicit null clears it. The mock
// provider stores no settings at all: for it only `enabled` is accepted and
// any other field in the body is ignored.
router.put('/:name', requireAuth, requireRole('superadmin'), (req: Request, res: Response) => {
  const name = String(req.params.name);
  const row = findAIProviderByName(name);
  if (!row) throw new AppError('AI provider not found', 404);

  const body = req.body ?? {};
  const batch: Record<string, string | null> = {};

  if (name !== 'mock') {
    for (const key of FLAT_SETTING_KEYS) {
      if (body[key] !== undefined) {
        batch[key] = body[key] === '' || body[key] === null ? null : String(body[key]);
      }
    }
    if (body.temperature !== undefined && body.temperature !== null && body.temperature !== '') {
      batch.temperature = String(body.temperature);
    }
    if (body.timeout !== undefined) {
      const timeout = normalizeTimeoutSeconds(body.timeout);
      batch.timeout = timeout !== undefined ? String(timeout) : null;
    }
    if (body.concurrency !== undefined) {
      const concurrency = normalizeConcurrency(body.concurrency);
      batch.concurrency = concurrency !== undefined ? String(concurrency) : null;
    }
    if (body.web_search !== undefined && body.web_search !== null) {
      batch.web_search = body.web_search ? 'true' : 'false';
    }
    // An empty API key keeps the stored one; null deletes it.
    if (body.api_key === null) {
      batch.api_key = null;
    } else if (body.api_key !== undefined && body.api_key !== '') {
      batch.api_key = String(body.api_key);
    }
  }

  if (Object.keys(batch).length > 0) {
    setAIProviderConfigBatch(row.id, batch);
  }
  if (typeof body.enabled === 'boolean') {
    setAIProviderEnabled(name, body.enabled);
  }

  const activeProvider = (loadGlobalAIConfig().provider ?? 'mock') as AIProviderName;
  const fresh = findAIProviderByName(name);
  res.json({ success: true, data: fresh ? toPublicProvider(fresh, activeProvider) : null });
});

export default router;
