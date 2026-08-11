import { AITextSuggester, AI_PROVIDER_DEFAULT_URLS, getAIProviderBaseUrl } from '../backend/src/modules/ai-text-suggester/ai-text-suggester';
import { AIConfig, ProductData } from '../backend/src/types';

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

  describe('Caching stubs', () => {
    it('returns null from getCachedSuggestions until caching is implemented', async () => {
      const suggester = makeSuggester();

      await expect(suggester.getCachedSuggestions('some-key')).resolves.toBeNull();
    });
  });
});
