import { filterImageUrls, isImageUrl } from '../backend/src/utils/image-url-validation';

function imageResponse(contentType: string, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 404,
    headers: new Headers(contentType ? { 'content-type': contentType } : {}),
    body: null
  } as unknown as Response;
}

describe('isImageUrl', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('rejects URLs that do not parse as http(s)', async () => {
    await expect(isImageUrl('not a url')).resolves.toBe(false);
    await expect(isImageUrl('ftp://example.com/photo.png')).resolves.toBe(false);
  });

  it('rejects URLs whose fetch fails', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network error')) as unknown as typeof fetch;
    await expect(isImageUrl('https://img.example.com/photo.png')).resolves.toBe(false);
  });

  it('rejects a 200 answer that is not an image (e.g. an HTML page)', async () => {
    global.fetch = jest.fn().mockResolvedValue(imageResponse('text/html')) as unknown as typeof fetch;
    await expect(isImageUrl('https://img.example.com/photo.png')).resolves.toBe(false);
  });

  it('rejects a non-2xx answer even with an image Content-Type', async () => {
    global.fetch = jest.fn().mockResolvedValue(imageResponse('image/png', false)) as unknown as typeof fetch;
    await expect(isImageUrl('https://img.example.com/missing.png')).resolves.toBe(false);
  });

  it('accepts an http(s) URL whose answer is an image', async () => {
    global.fetch = jest.fn().mockResolvedValue(imageResponse('image/jpeg')) as unknown as typeof fetch;
    await expect(isImageUrl('https://img.example.com/photo.jpg')).resolves.toBe(true);
  });
});

describe('filterImageUrls', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('keeps only the URLs that are reachable images, preserving the order', async () => {
    const fetchMock = jest.fn();
    (fetchMock as jest.Mock)
      .mockResolvedValueOnce(imageResponse('text/html')) // fake HTML page
      .mockResolvedValueOnce(imageResponse('image/png')) // real image
      .mockResolvedValueOnce(Promise.reject(new Error('timeout'))) // unreachable
      .mockResolvedValueOnce(imageResponse('image/jpeg')); // real image
    global.fetch = fetchMock as unknown as typeof fetch;

    const urls = [
      'https://shop.example.com/fake.png',
      'https://img.example.com/real1.png',
      'https://img.example.com/dead.jpg',
      'https://img.example.com/real2.jpg'
    ];

    await expect(filterImageUrls(urls)).resolves.toEqual(['https://img.example.com/real1.png', 'https://img.example.com/real2.jpg']);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('returns an empty array when no URL is a valid image', async () => {
    global.fetch = jest.fn().mockResolvedValue(imageResponse('text/html')) as unknown as typeof fetch;
    await expect(filterImageUrls(['https://shop.example.com/a.png', 'https://shop.example.com/b.png'])).resolves.toEqual([]);
  });

  it('checks the URLs in parallel, so the wait is the slowest one and not the sum', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    global.fetch = jest.fn().mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 20));
      inFlight -= 1;
      return imageResponse('image/png');
    }) as unknown as typeof fetch;

    await expect(
      filterImageUrls([
        'https://img.example.com/1.png',
        'https://img.example.com/2.png',
        'https://img.example.com/3.png'
      ])
    ).resolves.toHaveLength(3);
    expect(maxInFlight).toBe(3);
  });
});