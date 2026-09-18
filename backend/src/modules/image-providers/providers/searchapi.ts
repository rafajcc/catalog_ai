// SearchAPI (Google Images).

import { ProviderError, ImageProvider, ImageSearchRequest } from '../types';
import { httpGet } from '../utils/http-client';
import { buildQuery, dedupe } from '../utils/url-utils';

export class SearchApiImageProvider extends ImageProvider {
  readonly slug = 'searchapi';

  async search(request: ImageSearchRequest): Promise<string[]> {
    const key = this.config.api_key?.trim();
    const query = buildQuery(request.brand, request.reference, request.ean);
    if (!key) throw new ProviderError('Falta la API key de SearchAPI');
    if (!query) throw new ProviderError('SearchAPI requiere marca, referencia o EAN');

    const response = await httpGet('https://www.searchapi.io/api/v1/search', {
      params: { engine: 'google_images', api_key: key, q: query, num: 12 }
    });

    if (response.status !== 200) throw new ProviderError(`HTTP ${response.status} en SearchAPI (revisa api_key)`);
    if (response.data?.error) throw new ProviderError(`SearchAPI: ${response.data.error}`);

    const urls = (response.data?.images ?? [])
      .map((item: Record<string, unknown>) => {
        const original = item.original as Record<string, unknown> | undefined;
        return typeof item.thumbnail === 'string' ? item.thumbnail : original?.link;
      })
      .filter((value: unknown): value is string => typeof value === 'string');
    const unique = dedupe(urls);
    if (unique.length === 0) throw new ProviderError(`SearchAPI no encontró imágenes para "${query}"`);
    return unique;
  }
}