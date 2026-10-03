// Shared types of the AI provider services.
//
// Each AI provider (OpenAI, Anthropic, OpenRouter, mock) is a small class
// exposing the same surface to the suggester: complete() answers the autocomplete
// prompt, generate()/improve() produce text for a content field, testConnection()
// verifies the credentials. The registry maps every provider id to its class so
// the suggester never switches on the provider name.

import axios from 'axios';
import { AIConfig, AICompletionRequest, AIRequest } from '../../types';
import { logger } from '../../utils/logger';
import { DEFAULT_AI_TIMEOUT_S, generateRequestId, getEffectiveModel } from './utils';

export type AIProviderAuthKind = 'api_key' | 'none';

// Recursively copies a request body replacing any credential-looking field
// (api_key, token, authorization, secret, ...) with a placeholder, so the logs
// can show exactly what is sent to the provider without ever leaking a key.
export function redactRequestBody(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactRequestBody);
  if (value && typeof value === 'object') {
    const redacted: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      redacted[key] = /(?:^|[_\-.])(?:api[_-]?key|token|authorization|auth|secret)(?:$|[_-])/i.test(key)
        ? '[REDACTED]'
        : redactRequestBody(item);
    }
    return redacted;
  }
  return value;
}

// Static metadata of an AI provider: how to show it, configure it and
// instantiate it. Registering a service here is all it takes to make it
// available to the suggester.
export interface AIProviderDefinition {
  slug: string;
  name: string;
  // 'api_key' providers authenticate with a Bearer/API key stored in the config;
  // 'none' providers (the mock) need no credentials.
  auth_kind: AIProviderAuthKind;
  // False for services that are listed but not implemented yet: they cannot be
  // selected as the active provider.
  implemented: boolean;
  // Well-known base URL of the provider, used when the config does not set an
  // explicit base_url.
  defaultBaseUrl: string;
  create: (config: AIConfig) => AIProvider;
}

// One AI provider service. Every cloud provider overrides complete() (and
// testConnection()) to call its HTTP API; generate()/improve() keep their own
// simplified implementations.
export abstract class AIProvider {
  abstract readonly slug: string;

  constructor(protected readonly config: AIConfig) {}

  // Sends the autocomplete prompt and returns the raw text the provider answers.
  abstract complete(request: AICompletionRequest): Promise<string>;

  abstract generate(request: AIRequest): Promise<any>;

  abstract improve(request: AIRequest, existingText: string): Promise<any>;

  // The mock provider needs no credentials and has nothing to contact, so the
  // connection test always succeeds for it. Real providers override this to
  // make an authenticated call.
  async testConnection(): Promise<boolean> {
    return true;
  }

  // Sends a JSON payload to the provider endpoint and returns the parsed body.
  // Every call is logged at info level: provider, model, the exact URL, every
  // request parameter and the full message (the body), so the operator can see
  // exactly what is sent to the provider. Authentication is never logged: the
  // API key travels in the Authorization header, which is not part of the log
  // meta, and any credential-looking field inside the body (api_key/token/...)
  // is replaced with a placeholder just in case a gateway expects it there.
  // The raw response stays in the DEBUG-level autocomplete logs to avoid
  // doubling the log volume.
  protected async postToProvider(url: string, headers: Record<string, string>, body: unknown, requestId?: string): Promise<any> {
    const startedAt = Date.now();
    // The autocomplete flow passes its own nonce so its request/response logs
    // and this HTTP call share the same id; standalone calls (connection tests)
    // get their own id so their two log lines stay linked too.
    const callId = requestId ?? generateRequestId();
    // The model meta is the exact value the provider receives (the effective
    // model, with the "auto" fallback resolved) so the operator always sees in
    // the logs what was really sent, never the raw empty config value.
    const logMeta = {
      provider: this.config.provider,
      model: getEffectiveModel(this.config),
      url,
      method: 'POST',
      requestId: callId
    };
    logger.info(`AI provider HTTP call [${callId}]`, {
      ...logMeta,
      body: redactRequestBody(body)
    });
    try {
      const response = await axios.post(url, body, {
        headers,
        timeout: (this.config.timeout ?? DEFAULT_AI_TIMEOUT_S) * 1000
      });
      logger.info(`AI provider HTTP call [${callId}]`, {
        ...logMeta,
        status: 'ok',
        durationMs: Date.now() - startedAt,
        httpStatus: response.status
      });
      return response.data;
    } catch (error) {
      logger.error(`AI provider HTTP call [${callId}]`, {
        ...logMeta,
        status: 'error',
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }
}