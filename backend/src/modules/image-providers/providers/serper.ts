// Serper (Google Images): POST /images with the query, imageUrl per result.

import { ProviderError, ImageProvider, ImageSearchRequest } from '../types';
import { httpPost } from '../utils/http-client';
import { buildQuery, dedupe } from '../utils/url-utils';

export class SerperImageProvider extends ImageProvider {
  readonly slug = 'serper';

  async search(request: ImageSearchRequest): Promise<string[]> {
    const key = this.config.api_key?.trim();
    const query = buildQuery(request.brand, request.reference, request.ean);
    if (!key) throw new ProviderError('Falta la API key de Serper');
    if (!query) throw new ProviderError('Serper requiere marca, referencia o EAN');

    const response = await httpPost('https://google.serper.dev/images', {
      data: { q: query, num: 12 },
      headers: { 'X-API-KEY': key }
    });

    if (response.status !== 200) throw new ProviderError(`HTTP ${response.status} en Serper (revisa api_key)`);

    const urls = (response.data?.images ?? [])
      .map((item: Record<string, unknown>) => item.imageUrl)
      .filter((value: unknown): value is string => typeof value === 'string');
    const unique = dedupe(urls);
    if (unique.length === 0) throw new ProviderError(`Serper no encontró imágenes en Google para "${query}"`);
    return unique;
  }
}