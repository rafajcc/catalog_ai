// The OpenAI-compatible AI providers (OpenAI, OpenRouter) must not send the
// sampling parameters that the GPT-5 / o-series reasoning models reject (any
// temperature other than the default 1, and the legacy max_tokens), or they
// answer with an HTTP 400 and the autocomplete gets no text proposals. The
// OpenAI provider talks the Responses API (/responses) and reads the answer
// from output_text, with an optional web_search tool.

import axios from 'axios';
import { OpenaiAIProvider } from '../backend/src/modules/ai-providers/providers/openai';
import { OpenrouterAIProvider } from '../backend/src/modules/ai-providers/providers/openrouter';
import { redactRequestBody } from '../backend/src/modules/ai-providers/types';
import { isReasoningModel } from '../backend/src/modules/ai-providers/utils';
import { logger } from '../backend/src/utils/logger';

jest.mock('axios', () => ({
  post: jest.fn().mockResolvedValue({
    data: {
      // Shaped so both the Responses API (output_text) and the chat-completions
      // parsers (choices) succeed when a test does not override the response.
      choices: [{ message: { content: '{"status":"ok"}' } }],
      output_text: '{"status":"ok"}'
    }
  })
}));

const mockPost = axios.post as jest.Mock;

function openAiConfig(overrides: Record<string, unknown> = {}): any {
  return {
    provider: 'openai',
    enabled_fields: ['description'],
    ...overrides
  };
}

function openRouterConfig(overrides: Record<string, unknown> = {}): any {
  return {
    provider: 'openrouter',
    enabled_fields: ['description'],
    ...overrides
  };
}

const completionRequest: any = {
  prompt: 'please answer',
  product: { id: 'p1' },
  fields: ['description'],
  requestId: 'test-request'
};

describe('isReasoningModel', () => {
  it('recognises the GPT-5 and o-series reasoning families', () => {
    expect(isReasoningModel('gpt-5')).toBe(true);
    expect(isReasoningModel('gpt-5.4-mini')).toBe(true);
    expect(isReasoningModel('gpt-5.4-nano')).toBe(true);
    expect(isReasoningModel('gpt-5-mini-2025-08-07')).toBe(true);
    expect(isReasoningModel('openai/gpt-5.4-mini')).toBe(true);
    expect(isReasoningModel('o1')).toBe(true);
    expect(isReasoningModel('o3-mini')).toBe(true);
    expect(isReasoningModel('o4-mini-2025-04-16')).toBe(true);
  });

  it('does not flag the classic chat models', () => {
    expect(isReasoningModel('gpt-4o-mini')).toBe(false);
    expect(isReasoningModel('gpt-4.1')).toBe(false);
    expect(isReasoningModel('gpt-4-turbo')).toBe(false);
    expect(isReasoningModel('openrouter/auto')).toBe(false);
    expect(isReasoningModel('')).toBe(false);
  });
});

describe('redactRequestBody', () => {
  it('keeps the non-credential fields and redacts api_key/token/authorization recursively', () => {
    expect(
      redactRequestBody({
        model: 'gpt-4o',
        input: 'full prompt message',
        tools: [{ type: 'web_search' }],
        api_key: 'sk-secret',
        nested: { Authorization: 'Bearer x', temperature: 0.2 }
      })
    ).toEqual({
      model: 'gpt-4o',
      input: 'full prompt message',
      tools: [{ type: 'web_search' }],
      api_key: '[REDACTED]',
      nested: { Authorization: '[REDACTED]', temperature: 0.2 }
    });
  });

  it('passes primitives and arrays through', () => {
    expect(redactRequestBody('plain string')).toBe('plain string');
    expect(redactRequestBody(['a', { model: 'x' }])).toEqual(['a', { model: 'x' }]);
  });
});

describe('OpenaiAIProvider', () => {
  beforeEach(() => {
    jest.spyOn(logger, 'info').mockImplementation(() => {});
    jest.spyOn(logger, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    mockPost.mockClear();
  });

  it('calls the Responses API, omits temperature and includes web_search by default for a GPT-5 reasoning model', async () => {
    const provider = new OpenaiAIProvider(
      openAiConfig({ model: 'gpt-5.4-mini', api_key: 'k', base_url: 'https://api.openai.com/v1' })
    );
    await provider.complete(completionRequest);
    const [url, body] = mockPost.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect(body.model).toBe('gpt-5.4-mini');
    expect(body.temperature).toBeUndefined();
    expect(body.input).toBe('please answer');
    expect(body.messages).toBeUndefined();
    expect(body.tools).toEqual([{ type: 'web_search' }]);
  });

  it('adds the web_search tool when the provider enables it', async () => {
    const provider = new OpenaiAIProvider(
      openAiConfig({ model: 'gpt-5.4-mini', api_key: 'k', base_url: 'https://api.openai.com/v1', web_search: true })
    );
    await provider.complete(completionRequest);
    const body = mockPost.mock.calls[0][1];
    expect(body.tools).toEqual([{ type: 'web_search' }]);
  });

  it('omits the web_search tool when disabled', async () => {
    const provider = new OpenaiAIProvider(
      openAiConfig({ model: 'gpt-5.4-mini', api_key: 'k', base_url: 'https://api.openai.com/v1', web_search: false })
    );
    await provider.complete(completionRequest);
    expect(mockPost.mock.calls[0][1].tools).toBeUndefined();
  });

  it('sends the configured temperature for classic chat models', async () => {
    const provider = new OpenaiAIProvider(
      openAiConfig({ model: 'gpt-4o-mini', api_key: 'k', base_url: 'https://api.openai.com/v1', temperature: 0.3 })
    );
    await provider.complete(completionRequest);
    expect(mockPost.mock.calls[0][1].temperature).toBe(0.3);
  });

  it('defaults temperature to 0.7 for classic chat models when unset', async () => {
    const provider = new OpenaiAIProvider(
      openAiConfig({ model: 'gpt-4o-mini', api_key: 'k', base_url: 'https://api.openai.com/v1' })
    );
    await provider.complete(completionRequest);
    expect(mockPost.mock.calls[0][1].temperature).toBe(0.7);
  });

  it('reads the answer from the Responses API output_text field', async () => {
    mockPost.mockResolvedValueOnce({ data: { output_text: 'proposed description' } });
    const provider = new OpenaiAIProvider(
      openAiConfig({ model: 'gpt-5.4-mini', api_key: 'k', base_url: 'https://api.openai.com/v1' })
    );
    await expect(provider.complete(completionRequest)).resolves.toBe('proposed description');
  });

  it('falls back to output[].content when output_text is absent', async () => {
    mockPost.mockResolvedValueOnce({
      data: {
        output: [
          { type: 'search_result', title: 'Armani official' },
          { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'fallback description' }] }
        ]
      }
    });
    const provider = new OpenaiAIProvider(
      openAiConfig({ model: 'gpt-5.4-mini', api_key: 'k', base_url: 'https://api.openai.com/v1' })
    );
    await expect(provider.complete(completionRequest)).resolves.toBe('fallback description');
  });

  it('fails when the Responses API returns no text', async () => {
    mockPost.mockResolvedValueOnce({ data: { output: [] } });
    const provider = new OpenaiAIProvider(
      openAiConfig({ model: 'gpt-5.4-mini', api_key: 'k', base_url: 'https://api.openai.com/v1' })
    );
    await expect(provider.complete(completionRequest)).rejects.toThrow('OpenAI returned no text content');
  });

  it('does not send a token cap or chat messages on the connection test', async () => {
    const provider = new OpenaiAIProvider(
      openAiConfig({ model: 'gpt-5.4-mini', api_key: 'k', base_url: 'https://api.openai.com/v1' })
    );
    await provider.testConnection();
    const [url, body] = mockPost.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect(body.model).toBe('gpt-5.4-mini');
    expect(body.input).toBe('ping');
    expect(body.messages).toBeUndefined();
    expect(body.max_tokens).toBeUndefined();
    expect(body.max_completion_tokens).toBeUndefined();
  });

  it('logs the exact URL, every parameter and the full message without authentication', async () => {
    const provider = new OpenaiAIProvider(
      openAiConfig({ model: 'gpt-5.4-mini', api_key: 'k', base_url: 'https://api.openai.com/v1' })
    );
    await provider.complete(completionRequest);

    const infoMeta = (logger.info as jest.Mock).mock.calls
      .map((call) => call[1] as any)
      .find((meta) => meta?.url === 'https://api.openai.com/v1/responses');

    expect(infoMeta).toBeDefined();
    expect(infoMeta.model).toBe('gpt-5.4-mini');
    expect(infoMeta.body).toMatchObject({
      model: 'gpt-5.4-mini',
      input: 'please answer'
    });
    // Authentication must never reach the logs: the header is not part of the
    // meta and no api_key field is mirrored from the config.
    expect(infoMeta.headers).toBeUndefined();
    expect(infoMeta.body.api_key).toBeUndefined();
  });
});

describe('OpenrouterAIProvider', () => {
  beforeEach(() => {
    jest.spyOn(logger, 'info').mockImplementation(() => {});
    jest.spyOn(logger, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    mockPost.mockClear();
  });

  it('omits temperature for a GPT-5 reasoning model routed through OpenRouter', async () => {
    const provider = new OpenrouterAIProvider(
      openRouterConfig({ model: 'openai/gpt-5.4-mini', api_key: 'k', base_url: 'https://openrouter.ai/api/v1' })
    );
    await provider.complete(completionRequest);
    const body = mockPost.mock.calls[0][1];
    expect(body.model).toBe('openai/gpt-5.4-mini');
    expect(body.temperature).toBeUndefined();
  });

  it('keeps temperature for the auto model', async () => {
    const provider = new OpenrouterAIProvider(
      openRouterConfig({ model: 'openrouter/auto', api_key: 'k', base_url: 'https://openrouter.ai/api/v1' })
    );
    await provider.complete(completionRequest);
    expect(mockPost.mock.calls[0][1].temperature).toBe(0.7);
  });

  it('does not send a token cap on the connection test', async () => {
    const provider = new OpenrouterAIProvider(
      openRouterConfig({ model: 'openai/gpt-5.4-mini', api_key: 'k', base_url: 'https://openrouter.ai/api/v1' })
    );
    await provider.testConnection();
    const body = mockPost.mock.calls[0][1];
    expect(body.max_tokens).toBeUndefined();
    expect(body.max_completion_tokens).toBeUndefined();
  });
});