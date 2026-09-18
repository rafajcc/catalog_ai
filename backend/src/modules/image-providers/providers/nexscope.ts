// Nexscope: runs an Amazon product search skill and collects every
// image-looking URL of the returned JSON.

import { ProviderError, ImageProvider, ImageSearchRequest } from '../types';
import { httpPost } from '../utils/http-client';
import { buildQuery, walkImages, dedupe } from '../utils/url-utils';

export class NexscopeImageProvider extends ImageProvider {
  readonly slug = 'nexscope';

  async search(request: ImageSearchRequest): Promise<string[]> {
    const key = this.config.api_key?.trim();
    const query = buildQuery(request.brand, request.reference, request.ean);
    if (!key) throw new ProviderError('Falta la API key de Nexscope');
    if (!query) throw new ProviderError('Nexscope requiere marca, referencia o EAN');

    const response = await httpPost('https://api.nexscope.ai/api/skill-api/v1/skills/amazon-broad-product-search/run', {
      data: { keyword: query, marketplace: this.config.marketplace?.trim() || 'amazon.es' },
      headers: { Authorization: `Bearer ${key}` }
    });

    if (response.status === 401 || response.status === 403) {
      throw new ProviderError(`HTTP ${response.status}: la clave nexscope_key no es válida`);
    }
    if (response.status !== 200) throw new ProviderError(`HTTP ${response.status} en la API de Nexscope`);

    const urls = dedupe(walkImages(response.data));
    if (urls.length === 0) throw new ProviderError(`Nexscope no encontró productos con imagen para "${query}"`);
    return urls;
  }
}