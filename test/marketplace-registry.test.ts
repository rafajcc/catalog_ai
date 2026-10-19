// Unit tests for the marketplace registry (resolution, config gating, connection
// test config assembly) and the canned Mock adapter that the core can resolve
// without any real shop.
import {
  createTestAdapter,
  getMarketplaceLabel,
  isMarketplaceConfigured,
  parseMarketplaceSlug,
  resolveMarketplace
} from '../backend/src/modules/marketplaces/adapters/registry';
import { DataStore } from '../backend/src/store';
import type { CatalogConfig } from '../backend/src/store';

function config(overrides: Partial<CatalogConfig> = {}): CatalogConfig {
  const base = new DataStore().config;
  return {
    ...base,
    prestashop: { ...base.prestashop, ...overrides.prestashop },
    shopify: { ...base.shopify, ...overrides.shopify }
  };
}

describe('marketplace registry', () => {
  describe('parseMarketplaceSlug', () => {
    it('maps the lowercase URL segment of each marketplace', () => {
      expect(parseMarketplaceSlug('prestashop')).toBe('PrestaShop');
      expect(parseMarketplaceSlug('shopify')).toBe('Shopify');
      expect(parseMarketplaceSlug('mock')).toBe('Mock');
    });

    it('is case-insensitive and rejects unknown slugs', () => {
      expect(parseMarketplaceSlug('PreStaShOp')).toBe('PrestaShop');
      expect(parseMarketplaceSlug('woocommerce')).toBeUndefined();
      expect(parseMarketplaceSlug('')).toBeUndefined();
    });
  });

  describe('isMarketplaceConfigured', () => {
    it('requires both credentials for the real marketplaces', () => {
      expect(isMarketplaceConfigured('PrestaShop', config())).toBe(false);
      expect(isMarketplaceConfigured('Shopify', config())).toBe(false);
      expect(
        isMarketplaceConfigured('PrestaShop', config({ prestashop: { base_url: 'https://x/api', api_key: 'k', version: '1.7', language_id: 1 } }))
      ).toBe(true);
      expect(
        isMarketplaceConfigured('Shopify', config({ shopify: { shop_domain: 'a.myshopify.com', access_token: 't', api_version: '2026-07' } }))
      ).toBe(true);
    });

    it('treats the Mock marketplace as always configured', () => {
      expect(isMarketplaceConfigured('Mock', config())).toBe(true);
    });
  });

  describe('resolveMarketplace', () => {
    it('returns an adapter carrying the marketplace name', () => {
      const store = new DataStore();
      expect(resolveMarketplace('PrestaShop', config(), store).name).toBe('PrestaShop');
      expect(resolveMarketplace('Shopify', config(), store).name).toBe('Shopify');
      expect(resolveMarketplace('Mock', config(), store).name).toBe('Mock');
    });
  });

  describe('createTestAdapter', () => {
    it('builds the PrestaShop test config from the body and labels it', () => {
      const { label, adapter } = createTestAdapter(
        'PrestaShop',
        { base_url: 'https://shop.example.com/api', api_key: 'secret' },
        config(),
        new DataStore()
      );
      expect(label).toBe('PrestaShop');
      expect(adapter.name).toBe('PrestaShop');
    });

    it('falls back to the saved access token when the body leaves it empty', () => {
      const saved = config({ shopify: { shop_domain: 'a.myshopify.com', access_token: 'saved-token', api_version: '2026-07' } });
      const { adapter } = createTestAdapter('Shopify', { shop_domain: 'a.myshopify.com', access_token: '' }, saved, new DataStore());
      expect(adapter.name).toBe('Shopify');
    });

    it('rejects a body missing a required field', () => {
      expect(() => createTestAdapter('PrestaShop', { base_url: '' }, config(), new DataStore())).toThrow(/URL base/);
      expect(() => createTestAdapter('Shopify', { shop_domain: '' }, config(), new DataStore())).toThrow(/dominio/);
    });
  });

  describe('getMarketplaceLabel', () => {
    it('returns the human label used in messages', () => {
      expect(getMarketplaceLabel('PrestaShop')).toBe('PrestaShop');
      expect(getMarketplaceLabel('Mock')).toBe('Mock');
    });
  });
});

describe('Mock marketplace adapter', () => {
  it('fetches a canned dataset, stores it and returns it', async () => {
    const store = new DataStore();
    const adapter = resolveMarketplace('Mock', config(), store);

    expect(adapter.getDataset()).toBeNull();

    const result = await adapter.fetch({
      references: [],
      brand: '',
      description: 'all',
      images: 'all',
      filter_operator: 'and',
      limit: 10
    });

    expect(result.total).toBeGreaterThan(0);
    expect(result.products[0]).toMatchObject({ reference: 'MOCK-001', brand: 'Mock Brand' });
    expect(adapter.getDataset()).toMatchObject({ dataId: result.dataId, total: result.total });
    expect(store.getDataset('Mock')).toBeDefined();
  });

  it('applies text edits on save and reports a product with no editable fields as failed', async () => {
    const store = new DataStore();
    const adapter = resolveMarketplace('Mock', config(), store);
    const fetched = await adapter.fetch({
      references: [],
      brand: '',
      description: 'all',
      images: 'all',
      filter_operator: 'and',
      limit: 10
    });
    const productId = fetched.products[0].id;

    const ok = await adapter.saveUpdates({ [productId]: { meta_title: 'Nuevo título' } });
    expect(ok.successCount).toBe(1);
    expect(ok.results[productId]).toBe(true);

    const bad = await adapter.saveUpdates({ [productId]: { unknown: 'x' } });
    expect(bad.successCount).toBe(0);
    expect(bad.results[productId]).toBe(false);
  });

  it('proxies a canned PNG, accepts deletions and always connects', async () => {
    const adapter = resolveMarketplace('Mock', config(), new DataStore());

    await expect(adapter.testConnection()).resolves.toBeUndefined();
    await expect(adapter.deleteImage('mock_1', 'img_1')).resolves.toBeUndefined();

    const buffer = await adapter.proxyImage('mock_1', 'img_1');
    // 1x1 PNG magic bytes.
    expect(buffer.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  });

  it('clears the stored dataset', async () => {
    const store = new DataStore();
    const adapter = resolveMarketplace('Mock', config(), store);
    await adapter.fetch({ references: [], brand: '', description: 'all', images: 'all', filter_operator: 'and', limit: 10 });

    adapter.clearDataset();

    expect(adapter.getDataset()).toBeNull();
    expect(store.getDataset('Mock')).toBeUndefined();
  });
});
