// DataForSEO (Google Images, live advanced): basic-auth user/password, returns
// items with image_url/source_url/encoded_url.

import { ProviderError, ImageProvider, ImageSearchRequest } from '../types';
import { httpPost } from '../utils/http-client';
import { buildQuery, dedupe } from '../utils/url-utils';

export class DataForSEOImageProvider extends ImageProvider {
  readonly slug = 'dataforseo';

  async search(request: ImageSearchRequest): Promise<string[]> {
    const username = this.config.username?.trim();
    const password = this.config.password ?? '';
    const query = buildQuery(request.brand, request.reference, request.ean);
    if (!username || !password) {
      throw new ProviderError('Faltan usuario y contraseña de DataForSEO (login/password)');
    }
    if (!query) throw new ProviderError('DataForSEO requiere marca, referencia o EAN');

    const response = await httpPost('https://api.dataforseo.com/v3/serp/google/images/live/advanced', {
      data: [
        {
          keyword: query,
          depth: 10,
          location_name: this.config.location_name?.trim() || 'Spain',
          language_name: this.config.language_name?.trim() || 'Spanish'
        }
      ],
      auth: { username, password },
      timeoutS: 180
    });

    if (response.status === 401 || response.status === 403) {
      const message = response.data?.status_message;
      if (message) throw new ProviderError(`DataForSEO: ${message}`);
      throw new ProviderError(`HTTP ${response.status}: credenciales de DataForSEO inválidas`);
    }
    if (response.status !== 200) throw new ProviderError(`HTTP ${response.status} en DataForSEO`);

    const task = response.data?.tasks?.[0];
    if (task?.status_code && task.status_code !== 20000 && task.status_code !== null) {
      throw new ProviderError(`DataForSEO: ${task.status_message ?? task.error_message ?? 'error'}`);
    }
    const items = task?.result?.[0]?.items ?? [];
    const urls = dedupe(
      items
        .map((item: Record<string, unknown>) => item.image_url ?? item.source_url ?? item.encoded_url)
        .filter((value: unknown): value is string => typeof value === 'string')
    );
    if (urls.length === 0) throw new ProviderError(`DataForSEO no encontró imágenes para "${query}"`);
    return urls;
  }
}