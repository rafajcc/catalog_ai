// Bright Data: uses one configured zone to scrape the Google Images SERP raw
// HTML and extracts the image URLs with the shared HTML helper.

import { ProviderError, ImageProvider, ImageSearchRequest } from '../types';
import { httpPost } from '../utils/http-client';
import { buildQuery, extractGoogleImageUrls } from '../utils/url-utils';

export class BrightDataImageProvider extends ImageProvider {
  readonly slug = 'brightdata';

  async search(request: ImageSearchRequest): Promise<string[]> {
    const token = this.config.api_key?.trim();
    const zone = this.config.zone?.trim();
    const query = buildQuery(request.brand, request.reference, request.ean);
    if (!token) throw new ProviderError('Falta el token de Bright Data (api_key)');
    if (!zone) throw new ProviderError('Falta la zona de Bright Data (zone) en la configuración del servicio');
    if (!query) throw new ProviderError('Bright Data requiere marca, referencia o EAN');

    const response = await httpPost('https://api.brightdata.com/request', {
      data: { zone, url: `https://www.google.com/search?q=${encodeURIComponent(query)}&tbm=isch`, format: 'raw' },
      headers: { Authorization: `Bearer ${token}` },
      timeoutS: 180
    });

    if (response.status === 401 || response.status === 403) {
      throw new ProviderError(`HTTP ${response.status}: credenciales de Bright Data (api_key/zone) inválidas`);
    }
    if (response.status !== 200) throw new ProviderError(`HTTP ${response.status} en Bright Data`);

    const urls = extractGoogleImageUrls(response.text);
    if (urls.length === 0) throw new ProviderError(`Bright Data no encontró imágenes en Google para "${query}"`);
    return urls;
  }
}