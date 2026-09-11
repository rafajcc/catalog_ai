import fs from 'fs';
import os from 'os';
import path from 'path';
import { initDatabase, createComercio } from '../auth/database';
import { DatabasePersistence } from './database-persistence';
import { CatalogConfig } from '../../store';

function emptyPrestashop() {
  return { base_url: '', api_key: '', version: '1.7', language_id: 1 };
}

function config(overrides: Partial<CatalogConfig['ai']>): CatalogConfig {
  return {
    prestashop: emptyPrestashop(),
    ai: {
      provider: 'openai',
      providers: { openai: {} },
      enabled_fields: ['name', 'description'],
      ...overrides
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

  it('round-trips an AI provider timeout through save and load', () => {
    const persistence = new DatabasePersistence(comercioId);
    persistence.save(config({ providers: { openai: { model: 'gpt-4o', timeout: 60 } }, timeout: 60 }));

    const loaded = persistence.load();
    expect(loaded?.ai.providers?.openai?.timeout).toBe(60);
    expect(loaded?.ai.timeout).toBe(60);
  });

  it('round-trips an AI provider concurrency through save and load', () => {
    const persistence = new DatabasePersistence(comercioId);
    persistence.save(config({ providers: { openai: { model: 'gpt-4o', concurrency: 8 } }, concurrency: 8 }));

    const loaded = persistence.load();
    expect(loaded?.ai.providers?.openai?.concurrency).toBe(8);
    expect(loaded?.ai.concurrency).toBe(8);
  });

  it('falls back to the 5-call default when no concurrency is persisted', () => {
    const persistence = new DatabasePersistence(comercioId);
    persistence.save(config({ providers: { openai: { model: 'gpt-4o' } } }));

    const loaded = persistence.load();
    expect(loaded?.ai.providers?.openai?.concurrency).toBeUndefined();
    expect(loaded?.ai.concurrency).toBeUndefined();
  });

  it('removes the stored concurrency when the provider setting is cleared', () => {
    const persistence = new DatabasePersistence(comercioId);
    persistence.save(config({ providers: { openai: { concurrency: 8 } }, concurrency: 8 }));

    // Clearing in the UI drops the concurrency from the provider settings, so
    // the next save must delete the persisted value instead of keeping it.
    persistence.save(config({ providers: { openai: {} } }));

    const loaded = persistence.load();
    expect(loaded?.ai.providers?.openai?.concurrency).toBeUndefined();
    expect(loaded?.ai.concurrency).toBeUndefined();
  });

  it('falls back to the 30s default when no timeout is persisted', () => {
    const persistence = new DatabasePersistence(comercioId);
    persistence.save(config({ providers: { openai: { model: 'gpt-4o' } } }));

    const loaded = persistence.load();
    expect(loaded?.ai.providers?.openai?.timeout).toBeUndefined();
    expect(loaded?.ai.timeout).toBeUndefined();
  });

  it('removes the stored timeout when the provider setting is cleared', () => {
    const persistence = new DatabasePersistence(comercioId);
    persistence.save(config({ providers: { openai: { timeout: 60 } }, timeout: 60 }));

    // Clearing in the UI drops the timeout from the provider settings, so the
    // next save must delete the persisted value instead of keeping it.
    persistence.save(config({ providers: { openai: {} } }));

    const loaded = persistence.load();
    expect(loaded?.ai.providers?.openai?.timeout).toBeUndefined();
    expect(loaded?.ai.timeout).toBeUndefined();
  });
});