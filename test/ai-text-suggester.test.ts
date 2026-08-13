import { AITextSuggester, AI_PROVIDER_DEFAULT_URLS, getAIProviderBaseUrl } from '../backend/src/modules/ai-text-suggester/ai-text-suggester';
import { AIConfig, ProductData } from '../backend/src/types';
import axios from 'axios';

jest.mock('axios', () => ({
  post: jest.fn(),
  get: jest.fn()
}));

const mockAxiosPost = axios.post as jest.Mock;
const mockAxiosGet = axios.get as jest.Mock;

function makeProduct(overrides: Partial<ProductData> = {}): ProductData {
  return {
    id: 'ean_1234567890123',
    status: 'pending',
    source_file: 'test.csv',
    validation_errors: [],
    warnings: [],
    name: 'Test Product',
    ean: '1234567890123',
    reference: 'REF-001',
    ...overrides
  };
}

function makeSuggester(overrides: Partial<AIConfig> = {}): AITextSuggester {
  const config: AIConfig = {
    provider: 'mock',
    language: 'en',
    enabled_fields: ['name', 'description_short'],
    ...overrides
  };
  return new AITextSuggester(config);
}

describe('AITextSuggester', () => {
  describe('generateSuggestions', () => {
    it('generates a suggestion for a specific missing field', async () => {
      const suggester = makeSuggester({ enabled_fields: ['name'] });
      const product = makeProduct({ name: undefined, brand: 'Acme', category: 'Widgets' });

      const suggestions = await suggester.generateSuggestions(product, 'name');

      expect(suggestions).toHaveLength(1);
      expect(suggestions[0].original_field).toBe('name');
      expect(suggestions[0].suggested_value).toMatch(/^Professional Acme Widgets/);
      expect(suggestions[0].confidence).toBe(0.6);
      expect(suggestions[0].warnings).toContain('This is mock data - use real AI provider for production');
    });

    it('skips fields that already have content', async () => {
      const suggester = makeSuggester({ enabled_fields: ['name', 'description_short'] });
      const product = makeProduct({ description_short: 'Existing short description' });

      const suggestions = await suggester.generateSuggestions(product);

      expect(suggestions).toHaveLength(0);
    });

    it('generates suggestions for every enabled missing field', async () => {
      const suggester = makeSuggester({ enabled_fields: ['name', 'description_short'] });
      const product = makeProduct({ name: undefined, brand: 'Acme', category: 'Widgets' });

      const suggestions = await suggester.generateSuggestions(product);

      expect(suggestions).toHaveLength(2);
      expect(suggestions.map(s => s.original_field)).toEqual(['name', 'description_short']);
      expect(suggestions[1].suggested_value).toMatch(/^High-quality/);
    });
  });

  describe('validateSuggestion', () => {
    it('flags suggestions that exceed the field maximum length', async () => {
      const suggester = makeSuggester();
      const product = makeProduct();

      const result = await suggester.validateSuggestion(product, 'description', 'x'.repeat(600));

      expect(result.valid).toBe(false);
      expect(result.warnings[0]).toContain('exceeds maximum length (600/500');
    });

    it('flags suggestions that are too short', async () => {
      const suggester = makeSuggester();
      const product = makeProduct();

      const result = await suggester.validateSuggestion(product, 'name', 'tiny');

      expect(result.warnings).toContain('Suggested text is too short and may be generic');
    });

    it('flags suggestions identical to the original content', async () => {
      const suggester = makeSuggester();
      const product = makeProduct({ name: 'Test Product' });

      const result = await suggester.validateSuggestion(product, 'name', 'Test Product');

      expect(result.warnings).toContain('Suggestion is identical to original content');
    });

    it('flags meta content that is too long for SEO', async () => {
      const suggester = makeSuggester();
      const product = makeProduct();
      const fifteenWords = 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen';

      const result = await suggester.validateSuggestion(product, 'meta_description', fifteenWords);

      expect(result.warnings).toContain('Meta description may be too long for optimal SEO');
    });

    it('accepts a well-formed suggestion', async () => {
      const suggester = makeSuggester();
      const product = makeProduct();

      const result = await suggester.validateSuggestion(product, 'description', 'A detailed description. '.repeat(5));

      expect(result.valid).toBe(true);
      expect(result.warnings).toEqual([]);
    });
  });

  describe('improveExistingText', () => {
    it('improves existing text using the provider', async () => {
      const suggester = makeSuggester();
      const product = makeProduct({ description: 'Existing text' });

      const result = await suggester.improveExistingText(product, 'description');

      expect(result).toBe('Existing text (improved with AI suggestions)');
    });

    it('returns null when the field is missing', async () => {
      const suggester = makeSuggester();
      const product = makeProduct();

      const result = await suggester.improveExistingText(product, 'description');

      expect(result).toBeNull();
    });
  });

  describe('getSeoAnalysis', () => {
    it('analyzes a meta title', async () => {
      const suggester = makeSuggester();

      const analysis = await suggester.getSeoAnalysis('My Awesome Product', 'meta_title');

      expect(analysis).toMatchObject({ length: 18, word_count: 3, keyword_density: 0, seo_friendly: true });
    });

    it('marks an oversized meta title as not SEO friendly', async () => {
      const suggester = makeSuggester();

      const analysis = await suggester.getSeoAnalysis('x'.repeat(70), 'meta_title');

      expect(analysis.seo_friendly).toBe(false);
    });

    it('analyzes a meta description', async () => {
      const suggester = makeSuggester();
      const fifteenWords = 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen';

      const analysis = await suggester.getSeoAnalysis(fifteenWords, 'meta_description');

      expect(analysis.word_count).toBe(15);
      expect(analysis.seo_friendly).toBe(true);
    });

    it('detects features and specifications in a description', async () => {
      const suggester = makeSuggester();
      const text = 'This product includes premium features and precise specifications measured in mm for durability. '.repeat(3);

      const analysis = await suggester.getSeoAnalysis(text, 'description');

      expect(analysis.has_features).toBe(true);
      expect(analysis.has_specifications).toBe(true);
      expect(analysis.seo_friendly).toBe(true);
    });

    it('analyzes default fields like link_rewrite', async () => {
      const suggester = makeSuggester();

      const analysis = await suggester.getSeoAnalysis('premium-quality-widget', 'link_rewrite');

      expect(analysis.word_count).toBe(1);
      expect(analysis.seo_friendly).toBe(true);
    });
  });

  describe('getAIProviderBaseUrl', () => {
    it('maps every provider to its well-known base URL', () => {
      expect(AI_PROVIDER_DEFAULT_URLS.openai).toBe('https://api.openai.com/v1');
      expect(AI_PROVIDER_DEFAULT_URLS.anthropic).toBe('https://api.anthropic.com');
      expect(AI_PROVIDER_DEFAULT_URLS.openrouter).toBe('https://openrouter.ai/api/v1');
      expect(AI_PROVIDER_DEFAULT_URLS.gpt4all).toBe('http://127.0.0.1:4891/v1');
      expect(AI_PROVIDER_DEFAULT_URLS.mock).toBe('');
    });

    it('uses the explicit base_url when set', () => {
      const config: AIConfig = {
        provider: 'openai',
        enabled_fields: ['name'],
        base_url: 'https://proxy.example.com/openai'
      };
      expect(getAIProviderBaseUrl(config)).toBe('https://proxy.example.com/openai');
    });

    it('falls back to the provider default without an explicit base_url', () => {
      const config: AIConfig = { provider: 'anthropic', enabled_fields: ['name'] };
      expect(getAIProviderBaseUrl(config)).toBe('https://api.anthropic.com');
    });
  });

  describe('complete', () => {
    beforeEach(() => {
      mockAxiosPost.mockReset();
    });

    it('calls the OpenAI chat completions endpoint and returns the text content', async () => {
      mockAxiosPost.mockResolvedValue({ data: { choices: [{ message: { content: '{"ok":true}' } }] } });
      const suggester = makeSuggester({ provider: 'openai', model: 'gpt-4o-mini', api_key: 'sk-test' });

      const text = await suggester.complete({ prompt: 'Hello', product: makeProduct(), fields: ['description'] });

      expect(text).toBe('{"ok":true}');
      expect(mockAxiosPost).toHaveBeenCalledWith(
        'https://api.openai.com/v1/chat/completions',
        expect.objectContaining({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'Hello' }] }),
        expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer sk-test' }) })
      );
    });

    it('calls the Anthropic messages endpoint with the API key header', async () => {
      mockAxiosPost.mockResolvedValue({ data: { content: [{ type: 'text', text: 'anthropic answer' }] } });
      const suggester = makeSuggester({ provider: 'anthropic', api_key: 'ant-test' });

      const text = await suggester.complete({ prompt: 'Hello', product: makeProduct(), fields: ['description'] });

      expect(text).toBe('anthropic answer');
      expect(mockAxiosPost).toHaveBeenCalledWith(
        'https://api.anthropic.com/v1/messages',
        expect.objectContaining({ model: 'claude-3-5-haiku-latest', max_tokens: 1024 }),
        expect.objectContaining({ headers: expect.objectContaining({ 'x-api-key': 'ant-test' }) })
      );
    });

    it('calls the OpenRouter chat completions endpoint', async () => {
      mockAxiosPost.mockResolvedValue({ data: { choices: [{ message: { content: 'router answer' } }] } });
      const suggester = makeSuggester({ provider: 'openrouter', api_key: 'or-test' });

      const text = await suggester.complete({ prompt: 'Hello', product: makeProduct(), fields: ['description'] });

      expect(text).toBe('router answer');
      expect(mockAxiosPost).toHaveBeenCalledWith(
        'https://openrouter.ai/api/v1/chat/completions',
        expect.objectContaining({ model: 'openrouter/auto' }),
        expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer or-test' }) })
      );
    });

    it('calls the local GPT4All chat completions endpoint without an API key', async () => {
      mockAxiosPost.mockResolvedValue({ data: { choices: [{ message: { content: 'local answer' } }] } });
      const suggester = makeSuggester({ provider: 'gpt4all', model: 'Phi-3 Mini Instruct' });

      const text = await suggester.complete({ prompt: 'Hello', product: makeProduct(), fields: ['description'] });

      expect(text).toBe('local answer');
      expect(mockAxiosPost).toHaveBeenCalledWith(
        'http://127.0.0.1:4891/v1/chat/completions',
        expect.objectContaining({ model: 'Phi-3 Mini Instruct', messages: [{ role: 'user', content: 'Hello' }] }),
        expect.objectContaining({ headers: { 'Content-Type': 'application/json' } })
      );
    });

    it('uses a custom base URL when one is configured', async () => {
      mockAxiosPost.mockResolvedValue({ data: { choices: [{ message: { content: 'proxy answer' } }] } });
      const suggester = makeSuggester({ provider: 'openai', base_url: 'https://proxy.example.com/v1/' });

      const text = await suggester.complete({ prompt: 'Hello', product: makeProduct(), fields: ['description'] });

      expect(text).toBe('proxy answer');
      expect(mockAxiosPost).toHaveBeenCalledWith(
        'https://proxy.example.com/v1/chat/completions',
        expect.anything(),
        expect.anything()
      );
    });

    it('throws when the provider returns no text content', async () => {
      mockAxiosPost.mockResolvedValue({ data: { choices: [] } });
      const suggester = makeSuggester({ provider: 'openai', api_key: 'sk-test' });

      await expect(
        suggester.complete({ prompt: 'Hello', product: makeProduct(), fields: ['description'] })
      ).rejects.toThrow('OpenAI returned no text content');
    });

    it('propagates HTTP errors so the route can return a 502', async () => {
      mockAxiosPost.mockRejectedValue(new Error('connection refused'));
      const suggester = makeSuggester({ provider: 'openai', api_key: 'sk-test' });

      await expect(
        suggester.complete({ prompt: 'Hello', product: makeProduct(), fields: ['description'] })
      ).rejects.toThrow('connection refused');
    });

    it('keeps returning mock JSON for the mock provider without any HTTP call', async () => {
      const suggester = makeSuggester({ provider: 'mock' });

      const text = await suggester.complete({ prompt: 'Hello', product: makeProduct(), fields: ['description'] });
      const parsed = JSON.parse(text);

      expect(parsed.status).toBe('ok');
      expect(parsed.proposals.description.value).toContain('Test Product');
      expect(mockAxiosPost).not.toHaveBeenCalled();
    });
  });

  describe('testConnection', () => {
    beforeEach(() => {
      mockAxiosPost.mockReset();
      mockAxiosGet.mockReset();
    });

    it('succeeds for the mock provider without any HTTP call', async () => {
      const suggester = makeSuggester({ provider: 'mock' });

      await expect(suggester.testConnection()).resolves.toBe(true);
      expect(mockAxiosPost).not.toHaveBeenCalled();
      expect(mockAxiosGet).not.toHaveBeenCalled();
    });

    it('checks the local GPT4All server through GET /models', async () => {
      mockAxiosGet.mockResolvedValue({ data: { data: [{ id: 'Phi-3 Mini Instruct' }] } });
      const suggester = makeSuggester({ provider: 'gpt4all' });

      await expect(suggester.testConnection()).resolves.toBe(true);
      expect(mockAxiosGet).toHaveBeenCalledWith(
        'http://127.0.0.1:4891/v1/models',
        expect.objectContaining({ headers: { 'Content-Type': 'application/json' } })
      );
      expect(mockAxiosPost).not.toHaveBeenCalled();
    });

    it('fails for a cloud provider when the server rejects the request', async () => {
      const unauthorized = Object.assign(new Error('Request failed with status code 401'), {
        response: { status: 401, data: { error: { message: 'Incorrect API key provided' } } }
      });
      mockAxiosPost.mockRejectedValue(unauthorized);
      const suggester = makeSuggester({ provider: 'openai', api_key: 'invalid-key' });

      await expect(suggester.testConnection()).rejects.toThrow('Request failed with status code 401');
    });

    it('succeeds for a cloud provider when the authenticated call answers', async () => {
      mockAxiosPost.mockResolvedValue({ data: { choices: [{ message: { content: 'ok' } }] } });
      const suggester = makeSuggester({ provider: 'anthropic', api_key: 'valid-key' });

      await expect(suggester.testConnection()).resolves.toBe(true);
      expect(mockAxiosPost).toHaveBeenCalledWith(
        'https://api.anthropic.com/v1/messages',
        expect.objectContaining({ max_tokens: 1 }),
        expect.objectContaining({ headers: expect.objectContaining({ 'x-api-key': 'valid-key' }) })
      );
    });
  });

  describe('Caching stubs', () => {
    it('returns null from getCachedSuggestions until caching is implemented', async () => {
      const suggester = makeSuggester();

      await expect(suggester.getCachedSuggestions('some-key')).resolves.toBeNull();
    });
  });
});
