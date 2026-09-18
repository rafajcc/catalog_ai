// The mock AI provider: deterministic answers for every mode so the AI features
// work end to end without credentials or network access. Product images are NOT
// part of the autocomplete answer either: they come from the image-provider
// services (see modules/image-providers).

import { AIContentField, AICompletionRequest, AIRequest, ProductData } from '../../../types';
import { AIProvider } from '../types';

export class MockAIProvider extends AIProvider {
  readonly slug = 'mock';

  // The mock provider needs no credentials and has nothing to contact, so the
  // connection test always succeeds.
  async testConnection(): Promise<boolean> {
    return true;
  }

  async complete(request: AICompletionRequest): Promise<string> {
    return JSON.stringify(buildMockCompletion(request.product, request.fields), null, 2);
  }

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

// Builds a deterministic mock completion answer (valid JSON matching the
// contract appended to the prompt) from the product data, so the autocomplete
// flow works end to end with the current stub providers. Image URLs are NOT
// part of the mock answer: they come from the image-provider services.
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

  return {
    status: 'ok',
    confidence: 0.7,
    warnings: ['This is mock data - use a real AI provider for production'],
    reference,
    proposals: requested,
    seo_notes: [],
    source_facts_used: ['reference', 'brand', 'category', 'name']
  };
}