import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { ConfigPersistence } from '../backend/src/modules/config-persistence/config-persistence';
import { CatalogConfig } from '../backend/src/store';

const dirs: string[] = [];

function tempFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'catalogai-config-'));
  dirs.push(dir);
  return path.join(dir, 'config.json');
}

function makeConfig(): CatalogConfig {
  return {
    prestashop: { base_url: 'https://shop.example.com', api_key: 'ps-super-secret', version: '1.7', language_id: 1 },
    ai: { provider: 'openai', model: 'gpt-4o', api_key: 'ai-super-secret', language: 'es', enabled_fields: ['name'] }
  };
}

afterAll(async () => {
  for (const dir of dirs) {
    await fs.remove(dir);
  }
});

describe('ConfigPersistence', () => {
  it('saves and loads the configuration with secrets encrypted at rest', () => {
    const file = tempFile();
    const persistence = new ConfigPersistence(file, 'test-secret');
    persistence.save(makeConfig());

    const raw = fs.readFileSync(file, 'utf8');
    expect(raw).not.toContain('ps-super-secret');
    expect(raw).not.toContain('ai-super-secret');

    const parsed = JSON.parse(raw);
    expect(parsed.prestashop.api_key.__catalogai_encrypted__).toBe(true);
    expect(parsed.ai.api_key.__catalogai_encrypted__).toBe(true);

    const loaded = new ConfigPersistence(file, 'test-secret').load();
    expect(loaded?.prestashop.api_key).toBe('ps-super-secret');
    expect(loaded?.ai.api_key).toBe('ai-super-secret');
    expect(loaded?.prestashop.base_url).toBe('https://shop.example.com');
    expect(loaded?.ai.enabled_fields).toEqual(['name']);
  });

  it('keeps empty API keys unencrypted and restores them', () => {
    const file = tempFile();
    const config = makeConfig();
    config.prestashop.api_key = '';
    config.ai.api_key = '';

    new ConfigPersistence(file, 'test-secret').save(config);

    const raw = fs.readFileSync(file, 'utf8');
    expect(raw).not.toContain('__catalogai_encrypted__');

    const loaded = new ConfigPersistence(file, 'test-secret').load();
    expect(loaded?.prestashop.api_key).toBe('');
    expect(loaded?.ai.api_key).toBe('');
  });

  it('returns null when the file does not exist', () => {
    const file = path.join(tempFile(), '..', 'does-not-exist.json');
    expect(new ConfigPersistence(file, 'test-secret').load()).toBeNull();
  });

  it('returns null when the file is corrupted', () => {
    const file = tempFile();
    fs.writeFileSync(file, 'not json at all');
    expect(new ConfigPersistence(file, 'test-secret').load()).toBeNull();
  });

  it('returns null when the config cannot be decrypted with the current secret', () => {
    const file = tempFile();
    new ConfigPersistence(file, 'secret-a').save(makeConfig());
    expect(new ConfigPersistence(file, 'secret-b').load()).toBeNull();
  });

  it('generates and reuses a key file when no secret is provided', () => {
    const file = tempFile();
    new ConfigPersistence(file).save(makeConfig());

    const keyFile = `${file}.key`;
    expect(fs.existsSync(keyFile)).toBe(true);

    const loaded = new ConfigPersistence(file).load();
    expect(loaded?.prestashop.api_key).toBe('ps-super-secret');
    expect(loaded?.ai.api_key).toBe('ai-super-secret');
  });
});
