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

// The model actually sent to the provider: the configured one, or the provider's
// own default when none is saved. OpenRouter answers with a well-known "auto"
// model that picks the best model for the prompt, so an empty stored model must
// never disable the call (nor look like an empty model in the logs — the meta
// shows the effective model, the exact value in the HTTP body).
export function getEffectiveModel(config: AIConfig): string {
  if (config.model) return config.model;
  if (config.provider === 'openrouter') return 'openrouter/auto';
  return '';
}

// Whether the model id belongs to the OpenAI "reasoning" families (GPT-5 and
// the o-series). Those models reject the classic sampling parameters on the
// chat-completions endpoint: any temperature other than the default (1) is
// answered with an HTTP 400 ("Unsupported value: 'temperature' does not support
// 0.7 with this model"), and the legacy max_tokens is rejected too (they expect
// max_completion_tokens). The OpenAI-compatible providers skip temperature for
// these models so a config like `gpt-5.4-mini` works out of the box. The match
// is lenient on case and on the optional "openai/" vendor prefix used by
// routers like OpenRouter.
export function isReasoningModel(model: string): boolean {
  const normalized = model.trim().toLowerCase().replace(/^openai\//, '');
  return /^(gpt-5|o[0-9])([.-]|$)/.test(normalized);
}