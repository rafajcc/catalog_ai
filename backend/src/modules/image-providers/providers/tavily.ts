// Tavily: search API with include_images, plus per-result image arrays.

import { ProviderError, ImageProvider, ImageSearchRequest } from '../types';
import { httpPost } from '../utils/http-client';
import { buildQuery, dedupe } from '../utils/url-utils';

export class TavilyImageProvider extends ImageProvider {
  readonly slug = 'tavily';

  async search(request: ImageSearchRequest): Promise<string[]> {
    const key = this.config.api_key?.trim();
    const query = buildQuery(request.brand, request.reference, request.ean);
    if (!key) throw new ProviderError('Falta la API key de Tavily');
    if (!query) throw new ProviderError('Tavily requiere marca, referencia o EAN');

    const response = await httpPost('https://api.tavily.com/search', {
      data: { query: `producto ${query}`, include_images: true, max_results: 6, search_depth: 'basic' },
      headers: { Authorization: `Bearer ${key}` }
    });

    if (response.status !== 200) throw new ProviderError(`HTTP ${response.status} en Tavily (revisa api_key)`);

    const urls: string[] = [];
    for (const image of response.data?.images ?? []) {
      if (typeof image === 'string' && image.startsWith('http')) urls.push(image);
    }
    for (const result of response.data?.results ?? []) {
      for (const image of result.images ?? []) {
        if (typeof image === 'string' && image.startsWith('http')) urls.push(image);
      }
    }
    const unique = dedupe(urls, 24);
    if (unique.length === 0) throw new ProviderError(`Tavily no devolvió imágenes para "${query}"`);
    return unique;
  }
}