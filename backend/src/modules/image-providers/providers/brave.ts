// Brave Images API: keyed by plan, returns direct image URLs under
// results[].thumbnail.src and results[].properties.url.

import { ProviderError, ImageProvider, ImageSearchRequest } from '../types';
import { httpGet } from '../utils/http-client';
import { buildQuery, dedupe } from '../utils/url-utils';

export class BraveImageProvider extends ImageProvider {
  readonly slug = 'brave_images';

  async search(request: ImageSearchRequest): Promise<string[]> {
    const key = this.config.api_key?.trim();
    const query = buildQuery(request.brand, request.reference, request.ean);
    if (!key) throw new ProviderError('Falta la API key de Brave (se envía en la cabecera X-Subscription-Token)');
    if (!query) throw new ProviderError('Brave requiere marca, referencia o EAN');

    const response = await httpGet('https://api.search.brave.com/res/v1/images/search', {
      params: { q: query, count: 15, safesearch: 'strict' },
      headers: { 'X-Subscription-Token': key, Accept: 'application/json' }
    });

    if (response.status === 400 || response.status === 401 || response.status === 403 || response.status === 422) {
      throw new ProviderError(`HTTP ${response.status}: la clave brave_key no es válida o está mal formada`);
    }
    if (response.status === 429) throw new ProviderError('HTTP 429: tasa límite de Brave (plan gratuito)');
    if (response.status !== 200) throw new ProviderError(`HTTP ${response.status} en Brave Images API`);

    const urls: string[] = [];
    for (const result of response.data?.results ?? []) {
      const thumb = result.thumbnail?.src;
      if (thumb) urls.push(thumb);
      if (result.properties?.url) urls.push(result.properties.url);
    }
    const unique = dedupe(urls);
    if (unique.length === 0) throw new ProviderError(`Brave sin resultados de imagen para "${query}"`);
    return unique;
  }
}