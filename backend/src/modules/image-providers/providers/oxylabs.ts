// Oxylabs: Google Images search through the realtime queries API; images sit
// under results[].content.results.organic[].image, with a full-JSON walk as
// fallback.

import { ProviderError, ImageProvider, ImageSearchRequest } from '../types';
import { httpPost } from '../utils/http-client';
import { buildQuery, walkImages, dedupe } from '../utils/url-utils';

export class OxylabsImageProvider extends ImageProvider {
  readonly slug = 'oxylabs';

  async search(request: ImageSearchRequest): Promise<string[]> {
    const username = this.config.username?.trim();
    const password = this.config.password ?? '';
    const query = buildQuery(request.brand, request.reference, request.ean);
    if (!username || !password) {
      throw new ProviderError('Faltan usuario y contraseña de Oxylabs');
    }
    if (!query) throw new ProviderError('Oxylabs requiere marca, referencia o EAN');

    const response = await httpPost('https://realtime.oxylabs.io/v1/queries', {
      data: { source: 'google_search', query, parse: true, context: [{ key: 'tbm', value: 'isch' }] },
      auth: { username, password }
    });

    if (response.status === 401 || response.status === 403) {
      throw new ProviderError(`HTTP ${response.status}: credenciales de Oxylabs inválidas`);
    }
    if (response.status !== 200) throw new ProviderError(`HTTP ${response.status} en Oxylabs`);

    const urls = dedupe(walkImages(response.data));
    if (urls.length === 0) throw new ProviderError(`Oxylabs no encontró imágenes para "${query}"`);
    return urls;
  }
}