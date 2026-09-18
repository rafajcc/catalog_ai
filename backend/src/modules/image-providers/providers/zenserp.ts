// Zenserp (Google Images by tbm=isch).

import { ProviderError, ImageProvider, ImageSearchRequest } from '../types';
import { httpGet } from '../utils/http-client';
import { buildQuery, dedupe } from '../utils/url-utils';

export class ZenserpImageProvider extends ImageProvider {
  readonly slug = 'zenserp';

  async search(request: ImageSearchRequest): Promise<string[]> {
    const key = this.config.api_key?.trim();
    const query = buildQuery(request.brand, request.reference, request.ean);
    if (!key) throw new ProviderError('Falta la API key de Zenserp');
    if (!query) throw new ProviderError('Zenserp requiere marca, referencia o EAN');

    const response = await httpGet('https://app.zenserp.com/api/v2/search', {
      params: { apikey: key, q: query, tbm: 'isch' }
    });

    if (response.status !== 200) throw new ProviderError(`HTTP ${response.status} en Zenserp (revisa api_key)`);

    const urls = (response.data?.image_results ?? [])
      .map((item: Record<string, unknown>) => item.image_url ?? item.thumbnail)
      .filter((value: unknown): value is string => typeof value === 'string');
    const unique = dedupe(urls);
    if (unique.length === 0) throw new ProviderError(`Zenserp no encontró imágenes para "${query}"`);
    return unique;
  }
}