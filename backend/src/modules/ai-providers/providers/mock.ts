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