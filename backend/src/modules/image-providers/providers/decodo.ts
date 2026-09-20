// Decodo: basic-auth proxy scraper for Google Images. Mirrors the GetImages
// proof of concept: no proxy_pool is sent (the API defaults to the premium
// pool) and the response is requested as parsed JSON (`parse: true`) whose
// image URLs (high_res_image, image_url, ...) are collected by walking it.

import { ProviderError, ImageProvider, ImageSearchRequest } from '../types';
import { httpPost } from '../utils/http-client';
import { buildQuery, dedupe } from '../utils/url-utils';

const DECODO_IMAGE_KEYS = ['image_url', 'high_res_image', 'original', 'source_url', 'thumbnail', 'image'];
const IMAGE_EXT_RE = /\.(?:jpe?g|png|webp)($|\?)/i;

// Walks the parsed JSON tree (like the POC) collecting image URLs: values under
// an image-like key, or http(s) strings that look like image files.
export function collectDecodoImageUrls(data: unknown, acc: string[] = []): string[] {
  if (typeof data === 'string') {
    if (/^https?:\/\//i.test(data) && IMAGE_EXT_RE.test(data)) {
      acc.push(data);
    }
    return acc;
  }
  if (Array.isArray(data)) {
    for (const item of data) collectDecodoImageUrls(item, acc);
    return acc;
  }
  if (data && typeof data === 'object') {
    for (const [key, value] of Object.entries(data)) {
      if (typeof value === 'string') {
        if (/^https?:\/\//i.test(value)) {
          if (DECODO_IMAGE_KEYS.includes(key) || IMAGE_EXT_RE.test(value)) {
            acc.push(value);
          }
        }
      } else {
        collectDecodoImageUrls(value, acc);
      }
    }
  }
  return acc;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class DecodoImageProvider extends ImageProvider {
  readonly slug = 'decodo_premium';

  async search(request: ImageSearchRequest): Promise<string[]> {
    const username = this.config.username?.trim();
    const password = this.config.password ?? '';
    const query = buildQuery(request.brand, request.reference, request.ean);
    if (!username || !password) {
      throw new ProviderError('Faltan usuario y contraseña de Decodo');
    }
    if (!query) throw new ProviderError('Decodo requiere marca, referencia o EAN');

    const body = {
      target: 'google',
      url: `https://www.google.com/search?q=${encodeURIComponent(query)}&tbm=isch`,
      headless: 'html',
      parse: true,
      page_count: 1
    };

    let response = await httpPost('https://scraper-api.decodo.com/v2/scrape', {
      data: body,
      auth: { username, password },
      timeoutS: 180
    });
    for (let attempt = 0; response.status === 429 && attempt < 2; attempt++) {
      await sleep(20000 + 15000 * attempt);
      response = await httpPost('https://scraper-api.decodo.com/v2/scrape', {
        data: body,
        auth: { username, password },
        timeoutS: 180
      });
    }

    if (response.status === 401 || response.status === 403) {
      throw new ProviderError(`HTTP ${response.status}: credenciales de Decodo inválidas`);
    }
    if (response.status === 429) {
      throw new ProviderError('HTTP 429: excedido el límite de peticiones de Decodo (espera 1-2 min o revisa tu plan).');
    }
    if (response.status !== 200) {
      const message = response.data?.message ? `: ${response.data.message}` : '';
      throw new ProviderError(`HTTP ${response.status} en Decodo${message}`);
    }

    if (response.data?.status === 'failed') {
      throw new ProviderError(`Decodo: ${response.data.message ?? 'no se pudo scrapear el objetivo'}`);
    }

    const urls = dedupe(collectDecodoImageUrls(response.data));
    if (urls.length === 0) throw new ProviderError(`Decodo no encontró imágenes para "${query}"`);
    return urls;
  }
}