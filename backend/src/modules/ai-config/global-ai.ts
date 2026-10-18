// Global AI provider configuration, shared by every comercio.
//
// The whole AI provider setup (API keys, models, endpoints, timeouts and the
// active provider) lives in ONE place, configured by the super admin. Comercios
// only customize their own prompt; they can no longer pick or edit providers.

import { AppError } from '../../utils/error-handler';
import { AIConfig, AIProviderName, AIProviderSettings } from '../../types';
import {
  getAIProviderConfig,
  getGlobalSetting,
  listAIProviders
} from '../auth/database';

// Every provider the application knows about, in the order the UI lists them.
export const GLOBAL_AI_PROVIDER_NAMES: AIProviderName[] = ['mock', 'openai', 'anthropic', 'openrouter'];

export const PROVIDER_LABELS: Record<string, string> = {
  mock: 'Mock',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  openrouter: 'OpenRouter'
};

// Masked preview of a stored API key, shown to the super admin so a saved key
// is recognisable. The value never leaves the backend: only the first and last
// characters plus a fixed run of dots travel to the frontend. Short keys reveal
// less (a key of 8 characters or fewer reveals nothing) so the preview can
// never reproduce the whole key.
export function maskApiKey(apiKey?: string | null): string | null {
  const key = (apiKey ?? '').trim();
  if (!key) return null;
  const dots = '•'.repeat(8);
  if (key.length <= 8) return dots;
  const visible = key.length >= 12 ? 4 : 2;
  return `${key.slice(0, visible)}${dots}${key.slice(-visible)}`;
}

// Parses a raw AI request timeout (in seconds). Empty/null/'' means "use the
// 30s default", so it is normalized to undefined instead of being stored.
export function normalizeTimeoutSeconds(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

// Parses a raw AI request concurrency (number of simultaneous calls). Requires
// a positive integer; anything else (including empty/null/'') is cleared so the
// frontend default of 5 applies. Capped at 50 to protect the provider.
export function normalizeConcurrency(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? Math.min(n, 50) : undefined;
}

export function translateAIError(error: unknown, provider: AIProviderName): string {
  const raw = error instanceof Error ? error.message : String(error);
  const name = PROVIDER_LABELS[provider] ?? provider;

  if (/\b401\b/.test(raw)) return `La clave de API de ${name} no es válida. Revisa la configuración del proveedor`;
  if (/\b402\b/.test(raw)) return `La cuenta de ${name} no tiene créditos disponibles. Recarga saldo en el panel del proveedor e intenta de nuevo`;
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

// Reads the global AI configuration. The active provider's settings are
// mirrored flat (model, api_key, base_url, timeout, ...) which is what the AI
// suggesters consume; the full `providers` map is kept so the super admin UI
// can list every provider with its saved values.
export function loadGlobalAIConfig(): AIConfig {
  const activeName = (getGlobalSetting('active_ai_provider') || 'mock') as AIProviderName;

  const providers: Partial<Record<AIProviderName, AIProviderSettings>> = {};
  for (const row of listAIProviders()) {
    const name = row.name as AIProviderName;
    const cfg = getAIProviderConfig(row.id);
    const settings: AIProviderSettings = { enabled: row.enabled === 1 };
    if (cfg.model) settings.model = cfg.model;
    if (cfg.api_key) settings.api_key = cfg.api_key;
    if (cfg.language) settings.language = cfg.language;
    if (cfg.base_url) settings.base_url = cfg.base_url;
    if (cfg.temperature) settings.temperature = Number(cfg.temperature);
    if (cfg.timeout) settings.timeout = Number(cfg.timeout);
    if (cfg.concurrency) settings.concurrency = Number(cfg.concurrency);
    if (cfg.web_search !== undefined) settings.web_search = cfg.web_search === 'true';
    providers[name] = settings;
  }

  const active = providers[activeName] ?? {};

  return {
    provider: activeName,
    providers,
    enabled_fields: [],
    enabled: active.enabled,
    model: active.model,
    api_key: active.api_key,
    language: active.language,
    base_url: active.base_url,
    ...(active.temperature !== undefined ? { temperature: active.temperature } : {}),
    ...(active.timeout !== undefined ? { timeout: active.timeout } : {}),
    ...(active.concurrency !== undefined ? { concurrency: active.concurrency } : {}),
    ...(active.web_search !== undefined ? { web_search: active.web_search } : {})
  };
}

// An AI provider counts as configured when a real one (not the mock) is active
// with the API key it needs. The mock provider is a test fixture: letting it
// answer autocomplete would write fake copy into real products, so it is
// reported as "not configured".
export function isAiConfiguredGlobal(ai?: AIConfig): boolean {
  if (!ai || ai.provider === 'mock') return false;
  return Boolean(ai.api_key);
}

// Resolves the global active provider, throwing a clear 503 when none is
// usable. Called before any quota reservation or provider call so a comercio
// without a configured AI never pays for a call that cannot happen. The mock
// provider needs no credentials and stays usable (it is the dev/test provider);
// a real provider must be enabled and carry an API key.
export function resolveActiveProviderOrThrow(ai?: AIConfig): AIConfig {
  if (!ai || ai.enabled === false) {
    throw new AppError(
      'No hay ningún proveedor de IA configurado. Contacte con el administrador de la aplicación.',
      503,
      undefined,
      'ai_provider_not_configured'
    );
  }
  if (ai.provider !== 'mock' && !ai.api_key) {
    throw new AppError(
      'No hay ningún proveedor de IA configurado. Contacte con el administrador de la aplicación.',
      503,
      undefined,
      'ai_provider_not_configured'
    );
  }
  return ai;
}
