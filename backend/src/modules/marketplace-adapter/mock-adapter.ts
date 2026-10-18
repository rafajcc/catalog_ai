import { DataStore } from '../../store';
import { ProductData } from '../../types';
import {
  MarketplaceAdapter,
  MarketplaceFetchFilters,
  MarketplaceFetchResult,
  MarketplaceSaveResult
} from './types';

// A 1x1 transparent PNG used as the canned image bytes for the mock proxy.
const MOCK_IMAGE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

const EDITABLE_TEXT_FIELDS = ['description_short', 'description', 'meta_title', 'meta_description'] as const;

// Canned products returned by every fetch. They cover the fields the import
// flow relies on (text, brand/reference/EAN and a proxied image) so the whole
// fetch -> edit -> save loop can be exercised without a real shop.
function cannedProducts(): ProductData[] {
  return [
    {
      id: 'mock_1',
      status: 'pending',
      source_file: 'mock',
      validation_errors: [],
      warnings: [],
      name: 'Producto de ejemplo',
      description: '<p>Descripción de ejemplo</p>',
      description_short: 'Descripción corta',
      meta_title: 'Título SEO',
      meta_description: 'Descripción SEO',
      brand: 'Mock Brand',
      reference: 'MOCK-001',
      ean: '1234567890123',
      images: [
        {
          id: 'img_1',
          product_id: 'mock_1',
          url: '/api/fetch/mock/images/mock_1/img_1'
        }
      ]
    } as unknown as ProductData
  ];
}

// A full in-memory marketplace used for demos and for testing the fetch/save
// flow end to end without any external dependency. Every operation succeeds
// against a canned dataset held on the shared DataStore.
export function createMockAdapter(store: DataStore): MarketplaceAdapter {
  const products = cannedProducts();

  return {
    name: 'Mock',
    async testConnection() {
      // The mock is always reachable.
    },
    async fetch(_filters: MarketplaceFetchFilters): Promise<MarketplaceFetchResult> {
      const dataId = store.newId('mk');
      store.setDataset('Mock', {
        dataId,
        fileId: dataId,
        fileName: 'Mock',
        products,
        totalRows: products.length
      });
      return { dataId, products, total: products.length };
    },
    getDataset(): MarketplaceFetchResult | null {
      const dataset = store.getDataset('Mock');
      if (!dataset) return null;
      return { dataId: dataset.dataId, products: dataset.products, total: dataset.totalRows };
    },
    clearDataset() {
      store.setDataset('Mock', undefined);
    },
    async saveUpdates(updates: Record<string, unknown>): Promise<MarketplaceSaveResult> {
      const entries = Object.entries(updates);
      const results: Record<string, boolean> = {};
      const failures: string[] = [];
      let successCount = 0;

      for (const [productId, rawFields] of entries) {
        const source = (rawFields ?? {}) as Record<string, unknown>;
        const hasText = EDITABLE_TEXT_FIELDS.some((field) => typeof source[field] === 'string');
        if (!hasText) {
          results[productId] = false;
          failures.push(`no editable fields for product ${productId}`);
          continue;
        }
        const product = products.find((p) => p.id === productId);
        if (product) {
          for (const field of EDITABLE_TEXT_FIELDS) {
            if (typeof source[field] === 'string') (product as any)[field] = source[field];
          }
        }
        results[productId] = true;
        successCount += 1;
      }
      return { successCount, failures, results };
    },
    async proxyImage(_productId: string, _imageId: string): Promise<Buffer> {
      return MOCK_IMAGE;
    },
    async deleteImage(_productId: string, _imageId: string): Promise<void> {
      // The mock dataset is static, so deletions are accepted but change nothing.
    }
  };
}
