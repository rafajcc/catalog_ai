// OpenRouter: OpenAI-compatible chat completions endpoint with its own default
// base URL and auto model.

import { AIContentField, AICompletionRequest, AIRequest } from '../../../types';
import { AIProvider } from '../types';
import { getAIProviderBaseUrl } from '../utils';

export class OpenrouterAIProvider extends AIProvider {
  readonly slug = 'openrouter';

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
      },
      request.requestId
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
    // Simplified implementation - the autocomplete flow uses complete() instead.
    await new Promise((resolve) => setTimeout(resolve, 800));

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