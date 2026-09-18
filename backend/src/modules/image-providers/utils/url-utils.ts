// URL handling helpers shared by the image provider services, ported from the
// GetImages proof of concept: building the search query from the product data,
// pulling image-looking URLs out of arbitrary JSON, and filtering out
// advertisement/trackers clutter before the URLs are validated.

const IMAGE_KEY_RE = /(image|img|photo|picture|thumbnail|thumb)/i;
const SKIP_RE = /(logo|favicon|blank|spacer|pixel|track|activity|tiny|1x1|loading\.gif)/i;
const AD_HOST_RE = /(doubleclick|adsrvr|googlesyndication|googleadservices|scorecardresearch|facebook\.com|amazon-adsystem|mathtag|quantserve|adnxs|adservice|outbrain|taboola|teads|smartadserver)/i;

const GOOGLE_IMAGE_URL_RE = /(?:`)?"(https?:\/\/[^"]+?\.(?:jpe?g|png|webp)(?:\?[^"]*)?)"/g;
const GOOGLE_THUMB_URL_RE = /"(https?:\/\/[^"]*?encrypted-tbn0\.gstatic\.com[^"]*?)"/g;

// A candidate URL is kept when it is http(s) and not an ad/tracker or junk
// image (logo, spacer, pixel...).
export function looksOk(url: string | undefined | null): boolean {
  if (!url || !/^https?:\/\//i.test(url)) return false;
  const low = url.toLowerCase();
  if (AD_HOST_RE.test(low)) return false;
  if (SKIP_RE.test(low)) return false;
  return true;
}

// Deduplicates by origin URL (query string ignored), keeping only the URLs
// that pass looksOk. Drops the query string of \u-escaped google results.
export function dedupe(urls: string[], limit = 30): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of urls) {
    const u = unescapeUnicode(raw);
    if (!looksOk(u)) continue;
    const head = u.split('?')[0];
    if (seen.has(head)) continue;
    seen.add(head);
    out.push(u);
    if (out.length >= limit) break;
  }
  return out;
}

// JSON values escaped with \uXXXX sequences (Google SERP pages do this) come
// back readable.
export function unescapeUnicode(url: string): string {
  if (!/<|\\u/i.test(url)) return url;
  try {
    return decodeURIComponent(url.replace(/\\u([0-9a-fA-F]{4})/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16))));
  } catch {
    return url;
  }
}

// Search query: brand + reference first, EAN as a last resort. Mirrors the web
// searches of the proof of concept.
export function buildQuery(brand: string, reference: string, ean: string): string | null {
  const parts = [brand.trim(), reference.trim()].filter(Boolean);
  if (parts.length > 0) return parts.join(' ');
  return ean.trim() || null;
}

// Walks an arbitrary JSON tree collecting string values whose key looks like
// image/img/photo/... and that are http(s) URLs.
export function walkImages(node: unknown, acc: string[] = [], depth = 0): string[] {
  if (depth > 8 || node === null || node === undefined) return acc;
  if (Array.isArray(node)) {
    for (const item of node) walkImages(item, acc, depth + 1);
    return acc;
  }
  if (typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      const isImageKey = IMAGE_KEY_RE.test(key);
      if (isImageKey) {
        if (typeof value === 'string' && value.startsWith('http')) {
          acc.push(value);
        } else if (Array.isArray(value)) {
          for (const item of value) {
            if (typeof item === 'string' && item.startsWith('http')) {
              acc.push(item);
            } else if (item !== null && (typeof item === 'object' || Array.isArray(item))) {
              walkImages(item, acc, depth + 1);
            }
          }
        } else if (value !== null && typeof value === 'object') {
          walkImages(value, acc, depth + 1);
        }
      } else if (value !== null && (typeof value === 'object' || Array.isArray(value))) {
        walkImages(value, acc, depth + 1);
      }
    }
  }
  return acc;
}

// Extracts candidate image URLs from a Google Images SERP HTML page (used by
// the raw-HTML scraping providers: Bright Data, ScraperAPI, Decodo).
export function extractGoogleImageUrls(html: string): string[] {
  const urls: string[] = [];
  const raw = html.matchAll(GOOGLE_IMAGE_URL_RE);
  for (const match of raw) {
    const url = unescapeUnicode(match[1]);
    if (!/gstatic\.com\/images\/branding/.test(url) && !/ssl\.gstatic\.com/.test(url)) {
      urls.push(url);
    }
  }
  const thumbs = html.matchAll(GOOGLE_THUMB_URL_RE);
  for (const match of thumbs) {
    urls.push(unescapeUnicode(match[1]));
  }
  return dedupe(urls);
}