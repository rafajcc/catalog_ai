// AI Text Suggester Module
// Generates and suggests product text content using configurable AI providers.

import { ProductData, AIConfig, AIRequest, AIResponse, AIContentField, AIProviderName } from '../../types';
import { logger } from '../../utils/logger';

// Well-known base URLs of the supported AI providers. Used when the config does
// not set an explicit base_url, so the UI can show (and the suggester can log)
// the exact endpoint the selected provider would be called against.
export const AI_PROVIDER_DEFAULT_URLS: Record<AIProviderName, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
  openrouter: 'https://openrouter.ai/api/v1',
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
      case 'mock':
        return new MockProvider(this.config);
      default:
        return new MockProvider(this.config);
    }
  }

  async generateSuggestions(product: ProductData, field?: AIContentField): Promise<AIResponse[]> {
    const suggestions: AIResponse[] = [];

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
}

class OpenAIProvider extends AIProvider {
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
