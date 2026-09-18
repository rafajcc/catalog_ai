// BarcodeLookup (by EAN): the API returns a product record per barcode; the
// image URLs are walked out of the JSON tree with the shared helper.

import { ProviderError, ImageProvider, ImageSearchRequest } from '../types';
import { httpGet } from '../utils/http-client';
import { walkImages, dedupe } from '../utils/url-utils';

export class BarcodeLookupImageProvider extends ImageProvider {
  readonly slug = 'barcodelookup';

  async search(request: ImageSearchRequest): Promise<string[]> {
    const key = this.config.api_key?.trim();
    const ean = request.ean.trim();
    if (!key) throw new ProviderError('Falta la API key de BarcodeLookup. Sin ella este servicio rechaza la llamada');
    if (!ean) throw new ProviderError('BarcodeLookup consulta por EAN: rellena el campo EAN del producto');

    const response = await httpGet('https://api.barcodelookup.com/v3/products', {
      params: { barcode: ean, formatted: 'y', key }
    });

    if (response.status === 401 || response.status === 403) {
      throw new ProviderError(`HTTP ${response.status}: la API key de BarcodeLookup no es válida`);
    }
    if (response.status !== 200) throw new ProviderError(`HTTP ${response.status} en BarcodeLookup API`);

    const urls = dedupe(walkImages(response.data));
    if (urls.length === 0) throw new ProviderError(`BarcodeLookup no devuelve imágenes para el EAN ${ean}`);
    return urls;
  }
}