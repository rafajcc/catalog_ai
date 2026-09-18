// OpenSERP: Google Images via their image-search endpoint.

import { ProviderError, ImageProvider, ImageSearchRequest } from '../types';
import { httpGet } from '../utils/http-client';
import { buildQuery, dedupe } from '../utils/url-utils';

export class OpenSerpImageProvider extends ImageProvider {
  readonly slug = 'openserp';

  async search(request: ImageSearchRequest): Promise<string[]> {
    const key = this.config.api_key?.trim();
    const query = buildQuery(request.brand, request.reference, request.ean);
    if (!key) throw new ProviderError('Falta la API key de OpenSERP');
    if (!query) throw new ProviderError('OpenSERP requiere marca, referencia o EAN');

    const response = await httpGet('https://api.openserp.org/v1/google/image', {
      params: { text: query, limit: 12 },
      headers: { Authorization: `Bearer ${key}` }
    });

    if (response.status === 401 || response.status === 403) {
      throw new ProviderError(`HTTP ${response.status}: la API key de OpenSERP no es válida`);
    }
    if (response.status !== 200) throw new ProviderError(`HTTP ${response.status} en OpenSERP`);

    const urls = (response.data?.results ?? [])
      .map((item: Record<string, unknown>) => item.image_url ?? item.thumbnail_url)
      .filter((value: unknown): value is string => typeof value === 'string');
    const unique = dedupe(urls);
    if (unique.length === 0) throw new ProviderError(`OpenSERP no encontró imágenes para "${query}"`);
    return unique;
  }
}