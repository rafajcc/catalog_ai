// Decodo: basic-auth proxy scraper with two pools (standard / premium). The
// Google Images SERP HTML comes back escaped, so URLs are unescaped before
// being deduplicated.

import { ProviderError, ImageProvider, ImageSearchRequest } from '../types';
import { httpPost } from '../utils/http-client';
import { buildQuery, extractGoogleImageUrls } from '../utils/url-utils';

function createDecodoProvider(pool: 'standard' | 'premium') {
  return class DecodoImageProvider extends ImageProvider {
    readonly slug = pool === 'standard' ? 'decodo_standard' : 'decodo_premium';

    async search(request: ImageSearchRequest): Promise<string[]> {
      const username = this.config.username?.trim();
      const password = this.config.password ?? '';
      const query = buildQuery(request.brand, request.reference, request.ean);
      if (!username || !password) {
        throw new ProviderError('Faltan usuario y contraseña de Decodo');
      }
      if (!query) throw new ProviderError('Decodo requiere marca, referencia o EAN');

      const response = await httpPost('https://scraper-api.decodo.com/v2/scrape', {
        data: { url: `https://www.google.com/search?q=${encodeURIComponent(query)}&tbm=isch`, proxy_pool: pool, headless: 'html' },
        auth: { username, password },
        timeoutS: 180
      });

      if (response.status === 401 || response.status === 403) {
        throw new ProviderError(`HTTP ${response.status}: credenciales de Decodo inválidas`);
      }
      if (response.status !== 200) throw new ProviderError(`HTTP ${response.status} en Decodo`);

      if (response.data?.status === 'failed') {
        throw new ProviderError(`Decodo: ${response.data.message ?? 'no se pudo scrapear el objetivo'}`);
      }

      const urls: string[] = [];
      for (const result of response.data?.results ?? []) {
        const content = result.content;
        if (typeof content === 'string') {
          urls.push(...extractGoogleImageUrls(content));
        }
      }
      const unique = Array.from(new Set(urls)).slice(0, 30);
      if (unique.length === 0) throw new ProviderError(`Decodo no encontró imágenes para "${query}"`);
      return unique;
    }
  };
}

export const DecodoStandardImageProvider = createDecodoProvider('standard');
export const DecodoPremiumImageProvider = createDecodoProvider('premium');