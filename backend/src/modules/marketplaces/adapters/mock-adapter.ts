import { DataStore } from '../../../store';
import { ProductData } from '../../../types';
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

// Total number of canned products, enough to exercise paging, filtering and
// search flows without a real shop.
const MOCK_PRODUCT_COUNT = 60;

// A handful of brands reused across products, so several products share a brand
// (the brand filter must match by name, not only by unique values).
const MOCK_BRANDS = ['Mock Brand', 'Aurora', 'Nimbus', 'Vertex', 'Sahara'];

// Canned products returned by every fetch. They cover the fields the import
// flow relies on (text, brand/reference/EAN and proxied images) so the whole
// fetch -> edit -> save loop can be exercised without a real shop.
//
// The set is deterministic: 60 products with a unique reference each, a brand
// picked cyclically from MOCK_BRANDS, a varying number of images (0 to 5) and
// products both with and without descriptions, so every filter combination has
// something to match.
function cannedProducts(): ProductData[] {
  const products: ProductData[] = [];
  for (let index = 1; index <= MOCK_PRODUCT_COUNT; index += 1) {
    const id = `mock_${index}`;
    const reference = `MOCK-${String(index).padStart(3, '0')}`;
    const brand = MOCK_BRANDS[(index - 1) % MOCK_BRANDS.length];

    // 0 to 5 images in a repeating pattern, so some products have none.
    const imageCount = index % 6;
    const images = Array.from({ length: imageCount }, (_, imageIndex) => ({
      id: `img_${index}_${imageIndex + 1}`,
      product_id: id,
      url: `/api/fetch/mock/images/${id}/img_${index}_${imageIndex + 1}`
    }));

    // Every fourth product has no description, so both description filters
    // have matches.
    const hasDescription = index % 4 !== 0;

    const product: ProductData = {
      id,
      status: 'pending',
      source_file: 'mock',
      validation_errors: [],
      warnings: [],
      name: `Producto de ejemplo ${index}`,
      brand,
      reference,
      ean: String(1234567890123 + index),
      images
    } as unknown as ProductData;

    if (hasDescription) {
      product.description = `<p>Descripción de ejemplo del producto ${index}</p>`;
      product.description_short = `Descripción corta ${index}`;
      product.meta_title = `Título SEO ${index}`;
      product.meta_description = `Descripción SEO ${index}`;
    }

    products.push(product);
  }
  return products;
}

// Applies the import filters to the canned set so the Mock behaves like a real
// marketplace: references match by reference, brand by partial (case-insensitive)
// name, description and images by presence, combined with the chosen operator.
// A brand/reference filter with no match yields an empty result (the route then
// answers 404), exactly like the real adapters.
function selectProducts(products: ProductData[], filters: MarketplaceFetchFilters): ProductData[] {
  const references = filters.references.map((reference) => reference.trim().toLowerCase()).filter(Boolean);
  const brand = filters.brand?.trim().toLowerCase() ?? '';
  const hasReferenceFilter = references.length > 0;
  const hasBrandFilter = brand.length > 0;
  const or = filters.filter_operator === 'or';

  const result = products.filter((product) => {
    const refOk = hasReferenceFilter ? references.includes((product.reference ?? '').toLowerCase()) : undefined;
    const brandOk = hasBrandFilter ? (product.brand ?? '').toLowerCase().includes(brand) : undefined;
    const descOk =
      filters.description === 'with'
        ? Boolean(product.description?.trim())
        : filters.description === 'without'
          ? !product.description?.trim()
          : undefined;
    const imgOk =
      filters.images === 'with'
        ? (product.images?.length ?? 0) > 0
        : filters.images === 'without'
          ? (product.images?.length ?? 0) === 0
          : undefined;

    // Reference and brand form one group (a match on either accepts under OR);
    // the description/images presence form a second group. The groups follow
    // the selected operator, mirroring the real marketplaces.
    const groups: boolean[] = [];
    const idGroup = [refOk, brandOk].filter((value): value is boolean => value !== undefined);
    if (idGroup.length > 0) groups.push(or ? idGroup.some(Boolean) : idGroup.every(Boolean));
    const presence = [descOk, imgOk].filter((value): value is boolean => value !== undefined);
    if (presence.length > 0) groups.push(or ? presence.some(Boolean) : presence.every(Boolean));
    if (groups.length === 0) return true;
    return or ? groups.some(Boolean) : groups.every(Boolean);
  });

  const limit = Math.min(Math.max(1, filters.limit || result.length), result.length);
  return result.slice(0, limit);
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
    async fetch(filters: MarketplaceFetchFilters): Promise<MarketplaceFetchResult> {
      const selected = selectProducts(products, filters);
      const dataId = store.newId('mk');
      store.setDataset('Mock', {
        dataId,
        fileId: dataId,
        fileName: 'Mock',
        products: selected,
        totalRows: selected.length
      });
      return { dataId, products: selected, total: selected.length };
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
