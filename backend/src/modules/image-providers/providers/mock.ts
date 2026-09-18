// Mock image provider (development only). Returns the local test product
// images the frontend serves, so the autocomplete flow works end to end
// without any real API key. The URLs point back at the deployment origin.

import { ImageProvider, ImageSearchRequest } from '../types';

const TEST_IMAGE_SLUGS = [
  '/test-product-image.png',
  '/test-product-image-2.png',
  '/test-product-image-3.png',
  '/test-product-image-4.png',
  '/test-product-image-5.png'
];

export class MockImageProvider extends ImageProvider {
  readonly slug = 'mock';

  async search(request: ImageSearchRequest): Promise<string[]> {
    const base = request.origin || process.env.FRONTEND_URL || 'http://localhost:5173';
    return TEST_IMAGE_SLUGS.slice(0, request.maxResults).map((slug) => `${base}${slug}`);
  }
}