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

  // generate/improve removed in Stage 2 refactor; only complete() is used.

  private buildPrompt(request: AIRequest, improveMode: boolean): string {
    return `Generate ${improveMode ? 'an improved' : 'a new'} ${request.field} for the following product:
${JSON.stringify(request.product, null, 2)}

Context: ${request.context}
Language: ${request.language}
Max length: ${request.max_length}
Style: ${request.style.tone} tone, SEO-friendly: ${request.style.seo_friendly}, include features: ${request.style.include_features}, audience: ${request.style.audience}

Return only the ${request.field} content.`;
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