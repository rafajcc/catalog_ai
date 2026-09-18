// AI Text Suggester Module
// Generates and suggests product text content using configurable AI providers.
//
// The provider implementations live in ../ai-providers (one class per service,
// like the image providers): this file only orchestrates them, resolving the
// active provider through the registry so it never switches on the name.

import {
  ProductData,
  AIConfig,
  AIRequest,
  AIResponse,
  AICompletionRequest,
  AIContentField
} from '../../types';
import { logger } from '../../utils/logger';
import { AIProvider } from '../ai-providers/types';
import { createAIProvider } from '../ai-providers/registry';
import { generateRequestId, getAIProviderBaseUrl } from '../ai-providers/utils';

// Cloud-credential/endpoint defaults and request correlation helpers live in
// the ai-providers module; they are re-exported here so callers that imported
// them from this module keep working.
export {
  AI_PROVIDER_DEFAULT_URLS,
  DEFAULT_AI_TIMEOUT_S,
  generateRequestId,
  getAIProviderBaseUrl
} from '../ai-providers/utils';
export { AIProvider } from '../ai-providers/types';

export class AITextSuggester {
  private config: AIConfig;
  private provider: AIProvider;

  constructor(config: AIConfig) {
    this.config = config;
    this.provider = createAIProvider(config);
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

  // Sends the fully assembled prompt (filled with the product data plus the
  // fixed JSON-response contract) to the provider and returns the raw answer.
  // The exact message and the raw response are logged at DEBUG level so the AI
  // exchange can be inspected without spamming the normal logs.
  async complete(request: AICompletionRequest): Promise<string> {
    const startedAt = Date.now();
    const requestId = request.requestId ?? generateRequestId();
    // Thread the id into the request object so the provider passes the same
    // nonce down to its HTTP call logs.
    request.requestId = requestId;
    const logMeta = {
      provider: this.config.provider,
      model: this.config.model ?? '',
      baseUrl: getAIProviderBaseUrl(this.config),
      reference: request.product.reference ?? '',
      requestId
    };

    logger.debug(`AI autocomplete request [${requestId}]`, { ...logMeta, message: request.prompt });

    try {
      const response = await this.provider.complete(request);
      logger.debug(`AI autocomplete response [${requestId}]`, {
        ...logMeta,
        status: 'ok',
        durationMs: Date.now() - startedAt,
        response
      });
      return response;
    } catch (error) {
      logger.error(`AI autocomplete error [${requestId}]`, {
        ...logMeta,
        status: 'error',
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  // Verifies the provider can actually be reached and (for the cloud providers)
  // that the stored API key is accepted. The mock provider runs without
  // credentials, so for it this only checks connectivity.
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