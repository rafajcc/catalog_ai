// OpenAI: Responses API (https://api.openai.com/v1/responses), authenticated
// with the stored API key. The Responses API is the OpenAI endpoint that
// supports the "web_search" tool, so it is the only way the model can actually
// consult the web instead of answering from its own knowledge — the legacy
// chat completions endpoint has no web_search tool at all.

import { AIContentField, AICompletionRequest, AIRequest, ProductData } from '../../../types';
import { AIProvider } from '../types';
import { getAIProviderBaseUrl, isReasoningModel } from '../utils';

// The Responses API returns the final text in the `output_text` convenience
// field or, item by item, inside output[].content[] entries with type
// "output_text". Some OpenAI-compatible gateways only provide the item-level
// form, so both are supported.
function extractOutputText(data: any): string | undefined {
  if (typeof data?.output_text === 'string' && data.output_text.length > 0) {
    return data.output_text;
  }
  const parts: string[] = [];
  for (const item of data?.output ?? []) {
    if (!Array.isArray(item?.content)) continue;
    for (const chunk of item.content) {
      if (chunk?.type === 'output_text' && typeof chunk.text === 'string' && chunk.text.length > 0) {
        parts.push(chunk.text);
      }
    }
  }
  const joined = parts.join('\n').trim();
  return joined.length > 0 ? joined : undefined;
}

export class OpenaiAIProvider extends AIProvider {
  readonly slug = 'openai';

  async complete(request: AICompletionRequest): Promise<string> {
    const baseUrl = getAIProviderBaseUrl(this.config).replace(/\/$/, '');
    const model = this.config.model || 'gpt-4o-mini';
    const body: Record<string, unknown> = {
      model,
      input: request.prompt
    };
    if (this.config.web_search) {
      body.tools = [{ type: 'web_search' }];
    }
    // GPT-5 / o-series models reject any temperature other than the default (1),
    // so the parameter is only sent to the classic chat models that support it.
    if (!isReasoningModel(model)) {
      body.temperature = this.config.temperature ?? 0.7;
    }
    const data = await this.postToProvider(
      `${baseUrl}/responses`,
      {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.api_key ?? ''}`
      },
      body,
      request.requestId
    );
    const content = extractOutputText(data);
    if (content === undefined) {
      throw new Error('OpenAI returned no text content');
    }
    return content;
  }

  async testConnection(): Promise<boolean> {
    const baseUrl = getAIProviderBaseUrl(this.config).replace(/\/$/, '');
    const model = this.config.model || 'gpt-4o-mini';
    // Minimal connectivity + credentials call against the Responses API. No
    // token cap is sent: the legacy max_tokens is rejected by the reasoning
    // models, and a plain 'ping' prompt does not need one anyway. The web
    // search tool is not needed to validate the credentials.
    await this.postToProvider(
      `${baseUrl}/responses`,
      {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.api_key ?? ''}`
      },
      {
        model,
        input: 'ping'
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