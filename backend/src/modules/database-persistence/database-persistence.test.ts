import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  initDatabase,
  createComercio,
  setAIProviderConfigBatch,
  setGlobalSetting,
  findAIProviderByName
} from '../auth/database';
import { DatabasePersistence } from './database-persistence';
import { CatalogConfig } from '../../store';

function emptyPrestashop() {
  return { base_url: '', api_key: '', version: '1.7', language_id: 1 };
}

function config(overrides: Partial<CatalogConfig> = {}): CatalogConfig {
  return {
    active_marketplace: 'PrestaShop',
    prestashop: emptyPrestashop(),
    shopify: { shop_domain: '', access_token: '', api_version: '2026-07' },
    ai: {
      provider: 'openai',
      providers: { openai: {} },
      enabled_fields: ['name', 'description'],
      ...(overrides.ai ?? {})
    }
  };
}

describe('DatabasePersistence', () => {
  let dataDir: string;
  let comercioId: number;

  beforeEach(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'catalogai-persist-'));
    await initDatabase(dataDir);
    comercioId = createComercio('Test Shop').id;
  });

  afterEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('round-trips the PrestaShop configuration', () => {
    const persistence = new DatabasePersistence(comercioId);
    persistence.save({
      active_marketplace: 'PrestaShop',
      prestashop: { base_url: 'https://shop.example.com', api_key: 'secret', version: '1.7', language_id: 2 },
      shopify: { shop_domain: '', access_token: '', api_version: '2026-07' },
      ai: { provider: 'mock', enabled_fields: ['name'] }
    });

    const loaded = persistence.load();
    expect(loaded?.prestashop.base_url).toBe('https://shop.example.com');
    expect(loaded?.prestashop.api_key).toBe('secret');
    expect(loaded?.prestashop.language_id).toBe(2);
  });

  it('round-trips the per-comercio default prompt', () => {
    const persistence = new DatabasePersistence(comercioId);
    persistence.save({
      active_marketplace: 'PrestaShop',
      prestashop: emptyPrestashop(),
      shopify: { shop_domain: '', access_token: '', api_version: '2026-07' },
      ai: { provider: 'mock', enabled_fields: ['name'], default_prompt: 'Escribe para {name}' }
    });

    expect(persistence.load()?.ai.default_prompt).toBe('Escribe para {name}');
  });

  it('deletes the stored default prompt when it is cleared', () => {
    const persistence = new DatabasePersistence(comercioId);
    persistence.save({
      active_marketplace: 'PrestaShop',
      prestashop: emptyPrestashop(),
      shopify: { shop_domain: '', access_token: '', api_version: '2026-07' },
      ai: { provider: 'mock', enabled_fields: ['name'], default_prompt: 'Un prompt' }
    });

    // Saving without a prompt (reset-prompt) must remove the stored value so the
    // system default applies again.
    persistence.save({ active_marketplace: 'PrestaShop', prestashop: emptyPrestashop(), shopify: { shop_domain: '', access_token: '', api_version: '2026-07' }, ai: { provider: 'mock', enabled_fields: ['name'] } });

    expect(persistence.load()?.ai.default_prompt).toBeUndefined();
  });

  it('round-trips the enabled fields', () => {
    const persistence = new DatabasePersistence(comercioId);
    persistence.save({
      active_marketplace: 'PrestaShop',
      prestashop: emptyPrestashop(),
      shopify: { shop_domain: '', access_token: '', api_version: '2026-07' },
      ai: { provider: 'mock', enabled_fields: ['meta_title', 'meta_description'] }
    });

    expect(persistence.load()?.ai.enabled_fields).toEqual(['meta_title', 'meta_description']);
  });

  it('resolves the AI provider settings from the global configuration, not the saved config', () => {
    const openai = findAIProviderByName('openai')!;
    setAIProviderConfigBatch(openai.id, { model: 'gpt-4o', api_key: 'sk-global' });
    setGlobalSetting('active_ai_provider', 'openai');

    const persistence = new DatabasePersistence(comercioId);
    // Saving an AI provider per comercio is ignored: the global config wins.
    persistence.save(config({ ai: { provider: 'anthropic', enabled_fields: ['name'] } }));

    const loaded = persistence.load();
    expect(loaded?.ai.provider).toBe('openai');
    expect(loaded?.ai.model).toBe('gpt-4o');
    expect(loaded?.ai.api_key).toBe('sk-global');
  });

  it('defaults to the mock provider when nothing is configured globally', () => {
    const loaded = new DatabasePersistence(comercioId).load();
    expect(loaded?.ai.provider).toBe('mock');
  });
});
