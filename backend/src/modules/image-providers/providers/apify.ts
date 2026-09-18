// Apify: runs a Google Images (or EAN) actor through the Apify sync-run API and
// collects every image-looking URL of the returned dataset items.

import { ProviderError, ImageProvider, ImageSearchRequest } from '../types';
import { httpPost } from '../utils/http-client';
import { buildQuery, walkImages, dedupe } from '../utils/url-utils';

export class ApifyImageProvider extends ImageProvider {
  readonly slug = 'apify';

  async search(request: ImageSearchRequest): Promise<string[]> {
    const token = this.config.api_key?.trim();
    const actor = this.config.actor_id?.trim();
    if (!token) throw new ProviderError('Falta la API key de Apify (apify_token). Sin ella este servicio rechaza la llamada');
    if (!actor) throw new ProviderError('Falta el actor de Apify (actor_id) en la configuración del servicio');

    const ean = request.ean.trim();
    const query = buildQuery(request.brand, request.reference, request.ean);
    if (!ean && !query) throw new ProviderError('Apify requiere marca, referencia o EAN');

    const payload = ean
      ? { eans: [ean], maxImagesPerProduct: request.maxResults, skipSecondarySourceIfFound: false }
      : { queries: [query], maxResultsPerQuery: 12 };

    const url = `https://api.apify.com/v2/acts/${encodeURIComponent(actor)}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}&timeout=300`;
    const response = await httpPost(url, { data: payload, timeoutS: 300 });

    if (response.status !== 200 && response.status !== 201) {
      const extra = !ean ? ' El actor EAN de Apify requiere el campo EAN (o cambia al actor por query en la configuración del servicio)' : '';
      throw new ProviderError(`HTTP ${response.status} en Apify (revisa api_key y actor_id).${extra}`);
    }

    const items = Array.isArray(response.data) ? response.data : response.data?.items;
    if (!Array.isArray(items)) throw new ProviderError('Apify devolvió un formato inesperado');

    const urls = walkImages(items).concat(
      items
        .filter((item: Record<string, unknown>) => typeof item === 'object' && item !== null)
        .flatMap((item: Record<string, unknown>) =>
          ['url', 'image', 'imageUrl', 'original', 'image_url']
            .map((key) => item[key])
            .filter((value): value is string => typeof value === 'string' && value.startsWith('http'))
        )
    );
    const unique = dedupe(urls);
    if (unique.length === 0) {
      throw new ProviderError(`Apify no devolvió imágenes para ${ean ? `el EAN ${ean}` : `"${query}"`}`);
    }
    return unique;
  }
}