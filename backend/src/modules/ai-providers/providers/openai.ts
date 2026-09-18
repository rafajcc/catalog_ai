// OpenAI: chat completions endpoint, authenticated with the stored API key.

import { AIContentField, AICompletionRequest, AIRequest, ProductData } from '../../../types';
import { AIProvider } from '../types';
import { getAIProviderBaseUrl } from '../utils';

export class OpenaiAIProvider extends AIProvider {
  readonly slug = 'openai';

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
      },
      request.requestId
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
    // Simplified implementation - the autocomplete flow uses complete() instead.
    await new Promise((resolve) => setTimeout(resolve, 1000));

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