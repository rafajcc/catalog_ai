// AI Text Suggester Module
// Generates and suggests product text content using configurable AI providers.

import {
  ProductData,
  AIConfig,
  AIRequest,
  AIResponse,
  AICompletionRequest,
  AIContentField,
  AIProviderName
} from '../../types';
import { logger } from '../../utils/logger';
import axios from 'axios';

// Well-known base URLs of the supported AI providers. Used when the config does
// not set an explicit base_url, so the UI can show (and the suggester can log)
// the exact endpoint the selected provider would be called against.
export const AI_PROVIDER_DEFAULT_URLS: Record<AIProviderName, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
  openrouter: 'https://openrouter.ai/api/v1',
  gpt4all: 'http://127.0.0.1:4891/v1',
  mock: ''
};

export function getAIProviderBaseUrl(config: AIConfig): string {
  return config.base_url || AI_PROVIDER_DEFAULT_URLS[config.provider] || '';
}

export class AITextSuggester {
  private config: AIConfig;
  private provider: AIProvider;

  constructor(config: AIConfig) {
    this.config = config;
    this.provider = this.createProvider();
  }

  private createProvider(): AIProvider {
    switch (this.config.provider) {
      case 'openai':
        return new OpenAIProvider(this.config);
      case 'anthropic':
        return new AnthropicProvider(this.config);
      case 'openrouter':
        return new OpenRouterProvider(this.config);
      case 'gpt4all':
        return new GPT4AllProvider(this.config);
      case 'mock':
        return new MockProvider(this.config);
      default:
        return new MockProvider(this.config);
    }
  }

  async generateSuggestions(product: ProductData, field?: AIContentField): Promise<AIResponse[]> {    const suggestions: AIResponse[] = [];

    const targetFields = field ? [field] : this.config.enabled_fields;

    for (const targetField of targetFields) {
      if (!product[targetField as keyof ProductData]) {
        const suggestion = await this.generateSingleSuggestion(product, targetField);
        if (suggestion) {
          suggestions.push(suggestion);
        }
      }
    }

    return suggestions;
  }

  // Sends the fully assembled prompt (filled with the product data plus the
  // fixed JSON-response contract) to the provider and returns the raw answer.
  // The exact message and the raw response are logged at DEBUG level so the AI
  // exchange can be inspected without spamming the normal logs.
  async complete(request: AICompletionRequest): Promise<string> {
    const startedAt = Date.now();
    const logMeta = {
      provider: this.config.provider,
      model: this.config.model ?? '',
      baseUrl: getAIProviderBaseUrl(this.config),
      reference: request.product.reference ?? ''
    };

    logger.debug('AI autocomplete request', { ...logMeta, message: request.prompt });

    try {
      const response = await this.provider.complete(request);
      logger.debug('AI autocomplete response', {
        ...logMeta,
        status: 'ok',
        durationMs: Date.now() - startedAt,
        response
      });
      return response;
    } catch (error) {
      logger.error('AI autocomplete request', {
        ...logMeta,
        status: 'error',
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  // Verifies the provider can actually be reached and (for the cloud providers)
  // that the stored API key is accepted. The mock and the local GPT4All
  // providers run without credentials, so for them this only checks connectivity.
  async testConnection(): Promise<boolean> {
    return this.provider.testConnection();
  }

  private async generateSingleSuggestion(product: ProductData, field: AIContentField): Promise<AIResponse | null> {
    const startedAt = Date.now();
    const mode = 'generate';
    const logMeta = {
      provider: this.config.provider,
      model: this.config.model ?? '',
      baseUrl: getAIProviderBaseUrl(this.config),
      mode,
      field,
      language: this.config.language || 'en'
    };

    try {
      const request: AIRequest = {
        field,
        product,
        context: this.buildContext(product),
        language: this.config.language || 'en',
        max_length: this.getMaxLength(field),
        style: {
          tone: 'professional',
          audience: 'general',
          seo_friendly: true,
          include_features: true
        }
      };

      const response = await this.provider.generate(request);

      logger.info('AI provider request', { ...logMeta, status: 'ok', durationMs: Date.now() - startedAt });

      return {
        original_field: field,
        suggested_value: response.suggested_value,
        confidence: response.confidence,
        improvements: response.improvements,
        seo_notes: response.seo_notes,
        warnings: response.warnings
      };
    } catch (error) {
      logger.error('AI provider request', {
        ...logMeta,
        status: 'error',
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  private buildContext(product: ProductData): string {
    const context = [];

    if (product.brand) context.push(`Brand: ${product.brand}`);
    if (product.category) context.push(`Category: ${product.category}`);
    if (product.tax) context.push(`Tax group ID: ${product.tax}`);
    if (product.wholesale_price) context.push(`Wholesale price: $${product.wholesale_price}`);

    return context.join(', ') + '. ';
  }

  private getMaxLength(field: AIContentField): number {
    const defaults: Record<AIContentField, number> = {
      name: 100,
      description_short: 250,
      description: 500,
      meta_title: 60,
      meta_description: 160,
      link_rewrite: 100
    };
    return defaults[field] || 200;
  }

  async validateSuggestion(product: ProductData, field: AIContentField, suggestion: string): Promise<{ valid: boolean; warnings: string[] }> {
    const warnings: string[] = [];

    // Check length constraints
    const maxLength = this.getMaxLength(field);
    if (suggestion.length > maxLength) {
      warnings.push(`Suggested text exceeds maximum length (${suggestion.length}/${maxLength} characters)`);
    }

    // Check for generic content
    if (suggestion.length < 20) {
      warnings.push('Suggested text is too short and may be generic');
    }

    // Check for duplicate content
    if (product[field as keyof ProductData] === suggestion) {
      warnings.push('Suggestion is identical to original content');
    }

    // SEO checks
    if (field.includes('meta')) {
      const wordCount = suggestion.split(' ').length;
      if (wordCount > 12) {
        warnings.push('Meta description may be too long for optimal SEO');
      }
    }

    return {
      valid: warnings.length === 0,
      warnings
    };
  }

  async improveExistingText(product: ProductData, field: AIContentField): Promise<string | null> {
    const currentText = product[field as keyof ProductData] as string;
    if (!currentText) return null;

    const startedAt = Date.now();
    const mode = 'improve';
    const logMeta = {
      provider: this.config.provider,
      model: this.config.model ?? '',
      baseUrl: getAIProviderBaseUrl(this.config),
      mode,
      field,
      language: this.config.language || 'en'
    };

    try {
      const request: AIRequest = {
        field,
        product,
        context: this.buildContext(product),
        language: this.config.language || 'en',
        max_length: this.getMaxLength(field),
        style: {
          tone: 'professional',
          audience: 'general',
          seo_friendly: true,
          include_features: true
        }
      };

      const response = await this.provider.improve(request, currentText);

      logger.info('AI provider request', { ...logMeta, status: 'ok', durationMs: Date.now() - startedAt });

      return response.suggested_value;
    } catch (error) {
      logger.error('AI provider request', {
        ...logMeta,
        status: 'error',
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  async getSeoAnalysis(text: string, field: AIContentField): Promise<any> {
    const analysis: any = {};

    switch (field) {
      case 'meta_title':
        analysis.length = text.length;
        analysis.word_count = text.split(' ').length;
        analysis.keyword_density = this.calculateKeywordDensity(text, this.extractKeywords(this.buildContext({} as ProductData)));
        analysis.seo_friendly = text.length <= 60 && text.split(' ').length <= 10;
        break;

      case 'meta_description':
        analysis.length = text.length;
        analysis.word_count = text.split(' ').length;
        analysis.keyword_density = this.calculateKeywordDensity(text, this.extractKeywords(this.buildContext({} as ProductData)));
        analysis.seo_friendly = text.length <= 160 && text.split(' ').length >= 12 && text.split(' ').length <= 20;
        break;

      case 'description':
        analysis.word_count = text.split(' ').length;
        analysis.has_features = this.containsFeatures(text);
        analysis.has_specifications = this.containsSpecifications(text);
        analysis.seo_friendly = text.length > 100 && text.length < 2000;
        break;

      default:
        analysis.word_count = text.split(' ').length;
        analysis.seo_friendly = text.length > 10 && text.length < 500;
    }

    return analysis;
  }

  private calculateKeywordDensity(text: string, keywords: string[]): number {
    if (keywords.length === 0) return 0;

    const normalizedText = text.toLowerCase();
    let keywordMatches = 0;

    for (const keyword of keywords) {
      const keywordRegex = new RegExp(keyword.toLowerCase(), 'g');
      const matches = normalizedText.match(keywordRegex);
      if (matches) {
        keywordMatches += matches.length;
      }
    }

    const totalWords = text.split(' ').length;
    return totalWords > 0 ? keywordMatches / totalWords : 0;
  }

  private extractKeywords(context: string): string[] {
    const keywords: string[] = [];
    const words = context.toLowerCase().split(/\s+/);

    for (const word of words) {
      if (word.length > 3 && !this.isCommonWord(word)) {
        keywords.push(word);
      }
    }

    return keywords.slice(0, 5);
  }

  private isCommonWord(word: string): boolean {
    const commonWords = ['the', 'and', 'for', 'with', 'this', 'that', 'from', 'they', 'are', 'was', 'were', 'been', 'have', 'has', 'had', 'their', 'will', 'would', 'could', 'should', 'but', 'not', 'all', 'any', 'some', 'what', 'which', 'who', 'when', 'where', 'why', 'how'];
    return commonWords.includes(word);
  }

  private containsFeatures(text: string): boolean {
    const featureKeywords = ['feature', 'specification', 'technical', 'material', 'size', 'dimension', 'weight', 'color', 'style', 'design'];
    const normalizedText = text.toLowerCase();
    return featureKeywords.some(keyword => normalizedText.includes(keyword));
  }

  private containsSpecifications(text: string): boolean {
    const specKeywords = ['mm', 'cm', 'kg', 'g', 'liters', 'watt', 'hz', 'inch', 'px', 'resolution', 'megapixel'];
    const normalizedText = text.toLowerCase();
    return specKeywords.some(keyword => normalizedText.includes(keyword));
  }

  async cacheSuggestions(key: string, _suggestions: AIResponse[]): Promise<void> {
    // Implement caching if needed
    // This would typically use Redis or in-memory cache
    console.log(`Caching suggestions for key: ${key}`);
  }

  async getCachedSuggestions(key: string): Promise<AIResponse[] | null> {
    // Implement cache retrieval if needed
    console.log(`Retrieving cached suggestions for key: ${key}`);
    return null;
  }
}

abstract class AIProvider {
  protected config: AIConfig;

  constructor(config: AIConfig) {
    this.config = config;
  }

  abstract generate(request: AIRequest): Promise<any>;

  abstract improve(request: AIRequest, existingText: string): Promise<any>;

  // Sends a JSON payload to the provider endpoint and returns the parsed body.
  // Every call is logged at info level (provider, model, URL and outcome) so
  // the development backend log always shows which AI provider is contacted,
  // the same way PrestaShop API calls are logged. The request/response bodies
  // stay in the DEBUG-level autocomplete logs to avoid spamming the logs.
  protected async postToProvider(url: string, headers: Record<string, string>, body: unknown): Promise<any> {
    const startedAt = Date.now();
    const logMeta = {
      provider: this.config.provider,
      model: this.config.model ?? '',
      url,
      method: 'POST'
    };
    logger.info('AI provider HTTP call', logMeta);
    try {
      const response = await axios.post(url, body, { headers, timeout: 30000 });
      logger.info('AI provider HTTP call', {
        ...logMeta,
        status: 'ok',
        durationMs: Date.now() - startedAt,
        httpStatus: response.status
      });
      return response.data;
    } catch (error) {
      logger.error('AI provider HTTP call', {
        ...logMeta,
        status: 'error',
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  // GETs the provider endpoint and returns the parsed body, logged at info
  // level like the POST calls. Used by connection tests that only need to
  // verify the server answers (e.g. the local GPT4All model list).
  protected async getFromProvider(url: string, headers: Record<string, string>): Promise<any> {
    const startedAt = Date.now();
    const logMeta = {
      provider: this.config.provider,
      model: this.config.model ?? '',
      url,
      method: 'GET'
    };
    logger.info('AI provider HTTP call', logMeta);
    try {
      const response = await axios.get(url, { headers, timeout: 30000 });
      logger.info('AI provider HTTP call', {
        ...logMeta,
        status: 'ok',
        durationMs: Date.now() - startedAt,
        httpStatus: response.status
      });
      return response.data;
    } catch (error) {
      logger.error('AI provider HTTP call', {
        ...logMeta,
        status: 'error',
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  // Sends the autocomplete prompt and returns the raw text the provider answers.
  // The mock provider answers with a valid mock JSON matching the fixed
  // contract; every real provider overrides this to call its HTTP API and
  // return the model's raw response.
  async complete(request: AICompletionRequest): Promise<string> {
    return JSON.stringify(buildMockCompletion(request.product, request.fields), null, 2);
  }

  // The mock provider needs no credentials and has nothing to contact, so the
  // connection test always succeeds for it. Real providers override this to
  // make an authenticated call.
  async testConnection(): Promise<boolean> {
    return true;
  }
}

// Builds a deterministic mock completion answer (valid JSON matching the
// contract appended to the prompt) from the product data, so the autocomplete
// flow works end to end with the current stub providers.
function buildMockCompletion(product: ProductData, fields: AIContentField[]): any {
  const name = product.name || product.category || 'product';
  const brand = product.brand || '';
  const category = product.category || '';
  const reference = product.reference || '';

  const proposals: Record<string, { value: string | null; reason: string }> = {
    name: { value: name, reason: 'kept from product data' },
    description_short: {
      value: `Short description of ${name}${reference ? ` (ref. ${reference})` : ''}${brand ? ` from ${brand}` : ''}.`,
      reason: 'generated from the available product data'
    },
    description: {
      value: `<p>Long description of ${name}${brand ? ` by ${brand}` : ''}${category ? ` in the ${category} category` : ''}.</p>`,
      reason: 'generated from the available product data'
    },
    meta_title: {
      value: `${brand ? `${brand} ` : ''}${name}${category ? ` - ${category}` : ''}`.slice(0, 60),
      reason: 'generated from the available product data'
    },
    meta_description: {
      value: `Discover ${brand ? `${brand} ` : ''}${name}${category ? `, in the ${category} category` : ''}.`.slice(0, 160),
      reason: 'generated from the available product data'
    },
    link_rewrite: {
      value: `${brand ? `${brand}-` : ''}${name}`
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, ''),
      reason: 'generated from the available product data'
    }
  };

  const requested: Record<string, { value: string | null; reason: string }> = {};
  for (const field of fields) {
    if (proposals[field]) requested[field] = proposals[field];
  }

  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  const testImageUrl = `${frontendUrl}/test-product-image.svg`;

  return {
    status: 'ok',
    confidence: 0.7,
    warnings: ['This is mock data - use a real AI provider for production'],
    reference,
    proposals: requested,
    image_urls: [testImageUrl],
    seo_notes: [],
    source_facts_used: ['reference', 'brand', 'category', 'name']
  };
}

class OpenAIProvider extends AIProvider {
  async complete(request: AICompletionRequest): Promise<string> {
    const baseUrl = getAIProviderBaseUrl(this.config).replace(/\/$/, '');
    const data = await this.postToProvider(
      `${baseUrl}/chat/completions`,
      {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.api_key ?? ''}`
      },
      {
        model: this.config.model || 'gpt-4o-mini',
        temperature: this.config.temperature ?? 0.7,
        messages: [{ role: 'user', content: request.prompt }]
      }
    );
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.length === 0) {
      throw new Error('OpenAI returned no text content');
    }
    return content;
  }

  async testConnection(): Promise<boolean> {
    const baseUrl = getAIProviderBaseUrl(this.config).replace(/\/$/, '');
    await this.postToProvider(
      `${baseUrl}/chat/completions`,
      {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.api_key ?? ''}`
      },
      {
        model: this.config.model || 'gpt-4o-mini',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }]
      }
    );
    return true;
  }

  async generate(request: AIRequest): Promise<any> {
    // Simplified OpenAI integration - would use actual OpenAI API in production
    const prompt = this.buildPrompt(request, false);
    const response = await this.callOpenAI(prompt);
    return this.parseResponse(response, request.field);
  }

  async improve(request: AIRequest, _existingText: string): Promise<any> {
    const prompt = this.buildPrompt(request, true);
    const response = await this.callOpenAI(prompt);
    return this.parseResponse(response, request.field);
  }

  private buildPrompt(request: AIRequest, improveMode: boolean): string {
    const context = `Product context: ${request.context}
    
    ${improveMode ? `Current ${request.field}: ${request.product[request.field as keyof ProductData]}
    
    Please improve this text while maintaining the meaning and adding value:` : 'Please generate new text for the following field:'}

    Requirements:
    - Language: ${request.language}
    - Maximum length: ${request.max_length} characters
    - Style: ${request.style.tone} tone, ${request.style.audience} audience
    - SEO optimized: ${request.style.seo_friendly ? 'Yes' : 'No'}
    - Include features: ${request.style.include_features ? 'Yes' : 'No'}

    Field: ${request.field}

    Generated text:`;

    return context;
  }

  private async callOpenAI(prompt: string): Promise<any> {
    // Mock implementation - would use actual OpenAI API
    await new Promise(resolve => setTimeout(resolve, 1000));

    return {
      choices: [{
        text: `Generated text based on: ${prompt.substring(0, 100)}...`
      }]
    };
  }

  private parseResponse(response: any, _field: AIContentField): any {
    return {
      suggested_value: response.choices[0].text,
      confidence: 0.8,
      improvements: ['Improved formatting', 'Better SEO optimization'],
      seo_notes: {
        title_length: response.choices[0].text.length,
        keyword_optimization: true,
        meta_tags_valid: true
      },
      warnings: []
    };
  }
}

class AnthropicProvider extends AIProvider {
  async complete(request: AICompletionRequest): Promise<string> {
    const baseUrl = getAIProviderBaseUrl(this.config).replace(/\/$/, '');
    const data = await this.postToProvider(
      `${baseUrl}/v1/messages`,
      {
        'Content-Type': 'application/json',
        'x-api-key': this.config.api_key ?? '',
        'anthropic-version': '2023-06-01'
      },
      {
        model: this.config.model || 'claude-3-5-haiku-latest',
        max_tokens: 1024,
        temperature: this.config.temperature ?? 0.7,
        messages: [{ role: 'user', content: request.prompt }]
      }
    );
    const content = data?.content?.[0]?.text;
    if (typeof content !== 'string' || content.length === 0) {
      throw new Error('Anthropic returned no text content');
    }
    return content;
  }

  async testConnection(): Promise<boolean> {
    const baseUrl = getAIProviderBaseUrl(this.config).replace(/\/$/, '');
    await this.postToProvider(
      `${baseUrl}/v1/messages`,
      {
        'Content-Type': 'application/json',
        'x-api-key': this.config.api_key ?? '',
        'anthropic-version': '2023-06-01'
      },
      {
        model: this.config.model || 'claude-3-5-haiku-latest',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }]
      }
    );
    return true;
  }

  async generate(request: AIRequest): Promise<any> {
    // Simplified Anthropic integration
    const prompt = this.buildPrompt(request, false);
    const response = await this.callAnthropic(prompt);
    return this.parseResponse(response, request.field);
  }

  async improve(request: AIRequest, _existingText: string): Promise<any> {
    const prompt = this.buildPrompt(request, true);
    const response = await this.callAnthropic(prompt);
    return this.parseResponse(response, request.field);
  }

  private buildPrompt(request: AIRequest, improveMode: boolean): string {
    const basePrompt = `You are an expert product description writer specializing in ${request.context}.

    Please create ${improveMode ? 'an improved version of' : 'a new'} ${request.field.replace('_', ' ')} for a product.

    Requirements:
    - Language: ${request.language}
    - Length: ${request.max_length} characters max
    - Tone: ${request.style.tone}
    - Audience: ${request.style.audience}
    - SEO optimized: ${request.style.seo_friendly}

    Generated ${request.field.replace('_', ' ')}:`;

    return basePrompt;
  }

  private async callAnthropic(prompt: string): Promise<any> {
    // Mock implementation - would use actual Anthropic API
    await new Promise(resolve => setTimeout(resolve, 1200));

    return {
      completion: `Anthropic generated content based on: ${prompt.substring(0, 100)}...`
    };
  }

  private parseResponse(response: any, _field: AIContentField): any {
    return {
      suggested_value: response.completion,
      confidence: 0.85,
      improvements: ['Anthropic-style formatting', 'Comprehensive information'],
      seo_notes: {
        title_length: response.completion.length,
        keyword_optimization: true,
        meta_tags_valid: true
      },
      warnings: []
    };
  }
}

class OpenRouterProvider extends AIProvider {
  async complete(request: AICompletionRequest): Promise<string> {
    const baseUrl = getAIProviderBaseUrl(this.config).replace(/\/$/, '');
    const data = await this.postToProvider(
      `${baseUrl}/chat/completions`,
      {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.api_key ?? ''}`
      },
      {
        model: this.config.model || 'openrouter/auto',
        temperature: this.config.temperature ?? 0.7,
        messages: [{ role: 'user', content: request.prompt }]
      }
    );
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.length === 0) {
      throw new Error('OpenRouter returned no text content');
    }
    return content;
  }

  async testConnection(): Promise<boolean> {
    const baseUrl = getAIProviderBaseUrl(this.config).replace(/\/$/, '');
    await this.postToProvider(
      `${baseUrl}/chat/completions`,
      {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.api_key ?? ''}`
      },
      {
        model: this.config.model || 'openrouter/auto',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }]
      }
    );
    return true;
  }

  async generate(request: AIRequest): Promise<any> {
    // Simplified OpenRouter integration
    const prompt = this.buildPrompt(request, false);
    const response = await this.callOpenRouter(prompt);
    return this.parseResponse(response, request.field);
  }

  async improve(request: AIRequest, _existingText: string): Promise<any> {
    const prompt = this.buildPrompt(request, true);
    const response = await this.callOpenRouter(prompt);
    return this.parseResponse(response, request.field);
  }

  private buildPrompt(request: AIRequest, improveMode: boolean): string {
    return `Using ${this.config.model}, generate ${improveMode ? 'an improved' : 'a new'} ${request.field.replace('_', ' ')}:
    
    Context: ${request.context}
    Requirements: Length ${request.max_length}, ${request.style.tone} tone, SEO: ${request.style.seo_friendly}
    
    Generated ${request.field.replace('_', ' ')}:`;
  }

  private async callOpenRouter(prompt: string): Promise<any> {
    // Mock implementation - would use actual OpenRouter API
    await new Promise(resolve => setTimeout(resolve, 800));

    return {
      choices: [{
        text: `OpenRouter generated response for: ${prompt.substring(0, 100)}...`
      }]
    };
  }

  private parseResponse(response: any, _field: AIContentField): any {
    return {
      suggested_value: response.choices[0].text,
      confidence: 0.75,
      improvements: ['OpenRouter access to multiple models', 'Flexible response generation'],
      seo_notes: {
        title_length: response.choices[0].text.length,
        keyword_optimization: true,
        meta_tags_valid: true
      },
      warnings: []
    };
  }
}

// Local provider backed by the GPT4All desktop server, exposed at
// http://127.0.0.1:4891/v1 with an OpenAI-compatible API. It runs without any
// API key, so the connection test only checks that the server answers.
class GPT4AllProvider extends AIProvider {
  async complete(request: AICompletionRequest): Promise<string> {
    const baseUrl = getAIProviderBaseUrl(this.config).replace(/\/$/, '');
    const data = await this.postToProvider(
      `${baseUrl}/chat/completions`,
      { 'Content-Type': 'application/json' },
      {
        model: this.config.model || 'gpt4all',
        temperature: this.config.temperature ?? 0.7,
        messages: [{ role: 'user', content: request.prompt }]
      }
    );
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.length === 0) {
      throw new Error('GPT4All returned no text content');
    }
    return content;
  }

  async testConnection(): Promise<boolean> {
    const baseUrl = getAIProviderBaseUrl(this.config).replace(/\/$/, '');
    await this.getFromProvider(`${baseUrl}/models`, {
      'Content-Type': 'application/json'
    });
    return true;
  }

  async generate(request: AIRequest): Promise<any> {
    const prompt = this.buildPrompt(request, false);
    const response = await this.callGPT4All(prompt);
    return this.parseResponse(response, request.field);
  }

  async improve(request: AIRequest, _existingText: string): Promise<any> {
    const prompt = this.buildPrompt(request, true);
    const response = await this.callGPT4All(prompt);
    return this.parseResponse(response, request.field);
  }

  private buildPrompt(request: AIRequest, improveMode: boolean): string {
    return `Using local GPT4All, generate ${improveMode ? 'an improved' : 'a new'} ${request.field.replace('_', ' ')}:
    
    Context: ${request.context}
    Requirements: Length ${request.max_length}, ${request.style.tone} tone, SEO: ${request.style.seo_friendly}
    
    Generated ${request.field.replace('_', ' ')}:`;
  }

  private async callGPT4All(prompt: string): Promise<any> {
    await new Promise(resolve => setTimeout(resolve, 800));

    return {
      choices: [{
        text: `GPT4All generated response for: ${prompt.substring(0, 100)}...`
      }]
    };
  }

  private parseResponse(response: any, _field: AIContentField): any {
    return {
      suggested_value: response.choices[0].text,
      confidence: 0.75,
      improvements: ['Local inference without API key', 'Offline-friendly generation'],
      seo_notes: {
        title_length: response.choices[0].text.length,
        keyword_optimization: true,
        meta_tags_valid: true
      },
      warnings: []
    };
  }
}

class MockProvider extends AIProvider {
  async generate(request: AIRequest): Promise<any> {
    const mockResponses = {
      name: `Professional ${request.product.brand || 'Premium'} ${request.product.category || 'Product'} ${this.getRandomSuffix()}`,
      description_short: `High-quality ${request.product.category || 'product'} with ${request.product.brand || 'premium'} features. Ideal for ${request.product.category || 'general'} use.`,
      description: `Experience the perfect combination of quality and value with our ${request.product.brand || 'brand'} ${request.product.category || 'product'}. Crafted with attention to detail and designed for performance. Featuring ${request.product.description || 'advanced'} specifications that deliver exceptional results for your ${request.product.category || 'needs'}.`,
      meta_title: `${request.product.brand || 'Brand'} ${request.product.category || 'Product'} - Professional Quality`,
      meta_description: `Discover ${request.product.brand || 'Brand'}'s ${request.product.category || 'product'} collection. Premium quality products with exceptional features and value.`,
      link_rewrite: `${request.product.category || 'category'}/${request.product.brand || 'brand'}-product-${Date.now()}`
    };

    const suggestedValue = mockResponses[request.field] || `Generated ${request.field.replace('_', ' ')} content`;

    return {
      suggested_value: suggestedValue,
      confidence: 0.6,
      improvements: ['Mock data for testing', 'Consistent formatting'],
      seo_notes: {
        title_length: suggestedValue.length,
        keyword_optimization: true,
        meta_tags_valid: true
      },
      warnings: ['This is mock data - use real AI provider for production']
    };
  }

  async improve(request: AIRequest, existingText: string): Promise<any> {
    const improvedText = existingText + ' (improved with AI suggestions)';

    return {
      suggested_value: improvedText,
      confidence: 0.7,
      improvements: ['Enhanced readability', 'Added SEO optimization'],
      seo_notes: {
        title_length: improvedText.length,
        keyword_optimization: true,
        meta_tags_valid: true
      },
      warnings: ['This is mock data - use real AI provider for production']
    };
  }

  private getRandomSuffix(): string {
    const suffixes = ['Xtreme', 'Pro', 'Elite', 'Max', 'Premium', 'Advanced', 'Professional'];
    return suffixes[Math.floor(Math.random() * suffixes.length)];
  }
}
