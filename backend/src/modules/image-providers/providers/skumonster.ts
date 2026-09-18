// SkuMonster (by UPC/EAN/SKU): identifier lookup, images walked out of the
// JSON tree.

import { ProviderError, ImageProvider, ImageSearchRequest } from '../types';
import { httpGet } from '../utils/http-client';
import { walkImages, dedupe } from '../utils/url-utils';

export class SkuMonsterImageProvider extends ImageProvider {
  readonly slug = 'skumonster';

  async search(request: ImageSearchRequest): Promise<string[]> {
    const key = this.config.api_key?.trim();
    const identifier = request.ean.trim() || request.reference.trim();
    if (!key) throw new ProviderError('Falta la API key de SkuMonster');
    if (!identifier) throw new ProviderError('SkuMonster busca por EAN/UPC o SKU: rellena el EAN o la referencia');

    const base = this.config.base_url?.trim() || 'https://api.skumonster.com';
    const response = await httpGet(`${base}/api/v1/lookup`, {
      params: { identifier, token: key }
    });

    if (response.status === 401 || response.status === 403) {
      throw new ProviderError(`HTTP ${response.status}: la clave skumonster_key no es válida o sin plan`);
    }
    if (response.status !== 200) {
      throw new ProviderError(`HTTP ${response.status} desde ${base} (revisa base_url)`);
    }

    const urls = dedupe(walkImages(response.data));
    if (urls.length === 0) throw new ProviderError(`SkuMonster no devuelve imágenes para ${identifier}`);
    return urls;
  }
}