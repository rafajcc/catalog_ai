// SerpAPI (Google Images engine).

import { ProviderError, ImageProvider, ImageSearchRequest } from '../types';
import { httpGet } from '../utils/http-client';
import { buildQuery, dedupe } from '../utils/url-utils';

export class SerpApiImageProvider extends ImageProvider {
  readonly slug = 'serpapi';

  async search(request: ImageSearchRequest): Promise<string[]> {
    const key = this.config.api_key?.trim();
    const query = buildQuery(request.brand, request.reference, request.ean);
    if (!key) throw new ProviderError('Falta la API key de SerpAPI');
    if (!query) throw new ProviderError('SerpAPI requiere marca, referencia o EAN');

    const response = await httpGet('https://serpapi.com/search.json', {
      params: { engine: 'google_images', q: query, api_key: key, num: 12 }
    });

    if (response.status !== 200) throw new ProviderError(`HTTP ${response.status} en SerpAPI (revisa api_key)`);
    if (response.data?.error) throw new ProviderError(`SerpAPI: ${response.data.error}`);

    const urls = (response.data?.images_results ?? [])
      .map((item: Record<string, unknown>) => item.original ?? item.thumbnail)
      .filter((value: unknown): value is string => typeof value === 'string');
    const unique = dedupe(urls);
    if (unique.length === 0) throw new ProviderError(`SerpAPI no encontró imágenes para "${query}"`);
    return unique;
  }
}