// Small helpers shared by the AI provider services: the default endpoint of
// each well-known provider and the request timeout / correlation id used by the
// HTTP helper of the base class.

import { nanoid } from 'nanoid';
import { AIConfig, AIProviderName } from '../../types';

// Well-known base URLs of the supported AI providers. Used when the config does
// not set an explicit base_url, so the UI can show (and the suggester can log)
// the exact endpoint the selected provider would be called against.
export const AI_PROVIDER_DEFAULT_URLS: Record<AIProviderName, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
  openrouter: 'https://openrouter.ai/api/v1',
  mock: ''
};

// Request timeout in seconds used when a provider does not configure one
// (AIConfig.timeout). Kept in the same unit as the UI setting.
export const DEFAULT_AI_TIMEOUT_S = 30;

// Short per-request id (nonce) printed in every log line of one AI exchange so
// the autocomplete request/response logs can be correlated with the provider
// HTTP call logs when several calls run at the same time.
export function generateRequestId(): string {
  return nanoid(10);
}

// The effective base URL of the given config: the explicit base_url when set,
// the provider's well-known default otherwise.
export function getAIProviderBaseUrl(config: AIConfig): string {
  return config.base_url || AI_PROVIDER_DEFAULT_URLS[config.provider] || '';
}