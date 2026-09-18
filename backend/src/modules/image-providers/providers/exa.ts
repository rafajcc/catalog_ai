// Exa: semantic web search with image links attached to each result.

import { ProviderError, ImageProvider, ImageSearchRequest } from '../types';
import { httpPost } from '../utils/http-client';
import { buildQuery, dedupe } from '../utils/url-utils';

export class ExaImageProvider extends ImageProvider {
  readonly slug = 'exa';

  async search(request: ImageSearchRequest): Promise<string[]> {
    const key = this.config.api_key?.trim();
    const query = buildQuery(request.brand, request.reference, request.ean);
    if (!key) throw new ProviderError('Falta la API key de Exa');
    if (!query) throw new ProviderError('Exa requiere marca, referencia o EAN');

    const response = await httpPost('https://api.exa.ai/search', {
      data: { query: `producto: ${query}`, numResults: 10, contents: { extras: { imageLinks: 5 } } },
      headers: { 'x-api-key': key }
    });

    if (response.status === 401 || response.status === 402) {
      throw new ProviderError(`HTTP ${response.status}: la clave exa_key es inválida o sin crédito`);
    }
    if (response.status !== 200) throw new ProviderError(`HTTP ${response.status} en Exa API`);

    const urls: string[] = [];
    for (const result of response.data?.results ?? []) {
      if (typeof result.image === 'string') urls.push(result.image);
      for (const link of result.extras?.imageLinks ?? []) {
        if (typeof link === 'string') urls.push(link);
      }
    }
    const unique = dedupe(urls);
    if (unique.length === 0) throw new ProviderError(`Exa no devolvió imágenes asociadas a "${query}"`);
    return unique;
  }
}