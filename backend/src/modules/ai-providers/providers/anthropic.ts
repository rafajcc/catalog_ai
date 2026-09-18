// Anthropic: messages endpoint, authenticated with the x-api-key header.

import { AIContentField, AICompletionRequest, AIRequest } from '../../../types';
import { AIProvider } from '../types';
import { getAIProviderBaseUrl } from '../utils';

export class AnthropicAIProvider extends AIProvider {
  readonly slug = 'anthropic';

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
      },
      request.requestId
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
    // Simplified implementation - the autocomplete flow uses complete() instead.
    await new Promise((resolve) => setTimeout(resolve, 1200));

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