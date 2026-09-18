// ScraperAPI (Google Images): fetches the raw SERP HTML through the rotation
// proxy and extracts the image URLs from it.

import { ProviderError, ImageProvider, ImageSearchRequest } from '../types';
import { httpGet } from '../utils/http-client';
import { buildQuery, extractGoogleImageUrls } from '../utils/url-utils';

export class ScraperApiImageProvider extends ImageProvider {
  readonly slug = 'scraperapi';

  async search(request: ImageSearchRequest): Promise<string[]> {
    const key = this.config.api_key?.trim();
    const query = buildQuery(request.brand, request.reference, request.ean);
    if (!key) throw new ProviderError('Falta la API key de ScraperAPI');
    if (!query) throw new ProviderError('ScraperAPI requiere marca, referencia o EAN');

    const response = await httpGet('https://api.scraperapi.com/', {
      params: { api_key: key, url: `https://www.google.com/search?q=${encodeURIComponent(query)}&tbm=isch` },
      timeoutS: 180
    });

    if (response.status !== 200) {
      throw new ProviderError(`HTTP ${response.status} en ScraperAPI (revisa api_key)`);
    }

    const urls = extractGoogleImageUrls(response.text);
    if (urls.length === 0) throw new ProviderError(`ScraperAPI no encontró imágenes para "${query}"`);
    return urls;
  }
}