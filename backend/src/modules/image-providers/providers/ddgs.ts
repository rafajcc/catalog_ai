// DDGS (DuckDuckGo images): the public web endpoint the ddgs client wraps.
// First the vqd token is fetched from the DDG page for the query, then the
// i.js JSON endpoint returns the results with their image/thumbnail URLs.

import { ProviderError, ImageProvider, ImageSearchRequest } from '../types';
import { httpGet } from '../utils/http-client';
import { buildQuery, dedupe } from '../utils/url-utils';

const DDG_HOME = 'https://duckduckgo.com';

function extractVqd(html: string): string | null {
  const patterns = [
    /vqd=["']?(\d+-\d+(?:-\d+)?)["']?/,
    /"vqd":\s*"(\d+-\d+(?:-\d+)?)"/,
    /'vqd':\s*'(\d+-\d+(?:-\d+)?)'/
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return match[1];
  }
  return null;
}

export class DdgsImageProvider extends ImageProvider {
  readonly slug = 'ddgs';

  async search(request: ImageSearchRequest): Promise<string[]> {
    const query = buildQuery(request.brand, request.reference, request.ean);
    if (!query) throw new ProviderError('DuckDuckGo requiere marca, referencia o EAN');

    const home = await httpGet(`${DDG_HOME}/?q=${encodeURIComponent(query)}&t=h_&iax=images&ia=images`);
    const vqd = extractVqd(home.text);
    if (!vqd) throw new ProviderError('DuckDuckGo no devolvió el token vqd; puede estar bloqueando el acceso');

    const response = await httpGet(`${DDG_HOME}/i.js`, {
      params: { q: query, vqd, o: 'json', f: ',,,' },
      headers: { Referer: `${DDG_HOME}/?q=${encodeURIComponent(query)}&t=h_&iax=images&ia=images` }
    });
    if (response.status !== 200) throw new ProviderError(`HTTP ${response.status} en DuckDuckGo`);

    const urls = (response.data?.results ?? [])
      .map((item: Record<string, unknown>) => item.image ?? item.thumbnail)
      .filter((value: unknown): value is string => typeof value === 'string');
    const unique = dedupe(urls);
    if (unique.length === 0) throw new ProviderError(`DuckDuckGo no encontró imágenes para "${query}"`);
    return unique;
  }
}