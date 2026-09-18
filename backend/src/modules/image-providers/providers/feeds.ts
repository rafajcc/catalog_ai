// Feeds service: product images loaded by the super admin into the
// provider_feed_images table (MARCA / REFERENCIA / EAN / IMAGEN_URL). Looked up
// with three levels of specificity (brand+reference+ean, brand+reference,
// brand+ean) so a product only needs its known keys to match.

import { ProviderError, ImageProvider, ImageSearchRequest } from '../types';
import { lookupProviderFeedImages } from '../../auth/database';
import { dedupe } from '../utils/url-utils';

export class FeedsImageProvider extends ImageProvider {
  readonly slug = 'feeds';

  async search(request: ImageSearchRequest): Promise<string[]> {
    const urls = dedupe(lookupProviderFeedImages(request.brand, request.reference, request.ean));
    if (urls.length === 0) {
      throw new ProviderError('Ninguna fila del feed de proveedor coincide con la referencia/EAN de este producto');
    }
    return urls;
  }
}