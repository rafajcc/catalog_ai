// Firecrawl search restricted to images (sources: ["images"]).

import { ProviderError, ImageProvider, ImageSearchRequest } from '../types';
import { httpPost } from '../utils/http-client';
import { buildQuery, dedupe } from '../utils/url-utils';

export class FirecrawlImageProvider extends ImageProvider {
  readonly slug = 'firecrawl';

  async search(request: ImageSearchRequest): Promise<string[]> {
    const key = this.config.api_key?.trim();
    const query = buildQuery(request.brand, request.reference, request.ean);
    if (!key) throw new ProviderError('Falta la API key de Firecrawl');
    if (!query) throw new ProviderError('Firecrawl requiere marca, referencia o EAN');

    const response = await httpPost('https://api.firecrawl.dev/v2/search', {
      data: { query, sources: ['images'], limit: 20 },
      headers: { Authorization: `Bearer ${key}` }
    });

    if (response.status === 401 || response.status === 403) {
      throw new ProviderError(`HTTP ${response.status}: la API key de Firecrawl no es válida`);
    }
    if (response.status !== 200) throw new ProviderError(`HTTP ${response.status} en Firecrawl`);

    const urls = (response.data?.data?.images ?? [])
      .map((item: Record<string, unknown>) => item.imageUrl)
      .filter((value: unknown): value is string => typeof value === 'string');
    const unique = dedupe(urls);
    if (unique.length === 0) throw new ProviderError(`Firecrawl no encontró imágenes para "${query}"`);
    return unique;
  }
}