// Validates candidate image URLs returned by the AI providers. AI models are
// prone to inventing URLs that do not exist (or pointing at product pages
// instead of images), so the app checks every URL itself before accepting it:
// a URL must be a valid http(s) URL whose response is actually an image
// (Content-Type image/*). An HTTP 200 alone is not enough, many pages answer
// 200 while serving HTML. Only the response headers are read, the body is
// cancelled without downloading it.

export const IMAGE_URL_VALIDATION_TIMEOUT_MS = 10000;

const IMAGE_VALIDATION_USER_AGENT = 'CatalogAI/1.0';

// Returns true when the URL parses as an http(s) URL and the server answers
// with an image Content-Type. Any fetch failure, redirect trap, non-2xx status
// or non-image Content-Type makes it false.
export async function isImageUrl(url: string, timeoutMs = IMAGE_URL_VALIDATION_TIMEOUT_MS): Promise<boolean> {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  } catch {
    return false;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': IMAGE_VALIDATION_USER_AGENT }
    });
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) return false;
  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  // The headers already prove whether this is an image, so the body is not
  // downloaded: the same Content-Type check the image proxy applies later.
  await response.body?.cancel().catch(() => undefined);
  return contentType.startsWith('image/');
}

// Keeps only the URLs that pass isImageUrl, preserving the original order.
export async function filterImageUrls(urls: string[], timeoutMs?: number): Promise<string[]> {
  const valid: string[] = [];
  for (const url of urls) {
    if (await isImageUrl(url, timeoutMs)) valid.push(url);
  }
  return valid;
}