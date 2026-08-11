// Config persistence with secrets encrypted at rest.
// Sensitive fields (PrestaShop and AI API keys) are encrypted with AES-256-GCM
// before writing the config file. The encryption key is derived from the
// CONFIG_SECRET environment variable when set; otherwise a random key is
// generated once and stored next to the config file with 0600 permissions.

import crypto from 'crypto';
import fs from 'fs-extra';
import path from 'path';
import { logger } from '../../utils/logger';
import { CatalogConfig } from '../../store';
import { AIConfig, AIProviderName, AIProviderSettings } from '../../types';

const ENCRYPTION_MARKER = '__catalogai_encrypted__';
const KEY_DERIVATION_SALT = 'catalogai-config-v1';

interface EncryptedValue {
  [key: string]: unknown;
  iv: string;
  tag: string;
  data: string;
}

export class ConfigPersistence {
  private readonly filePath: string;
  private readonly key: Buffer;

  constructor(filePath: string, secret?: string) {
    this.filePath = filePath;
    this.key = this.loadKey(secret);
  }

  get path(): string {
    return this.filePath;
  }

  load(): CatalogConfig | null {
    try {
      if (!fs.existsSync(this.filePath)) return null;
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as CatalogConfig;
      return this.decryptConfig(parsed);
    } catch (error) {
      logger.error('Failed to load persisted configuration', {
        filePath: this.filePath,
        error: (error as Error).message
      });
      return null;
    }
  }

  save(config: CatalogConfig): void {
    const dir = path.dirname(this.filePath);
    fs.ensureDirSync(dir);
    const payload = JSON.stringify(this.encryptConfig(config), null, 2);
    const tmpPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tmpPath, payload, { mode: 0o600 });
    fs.renameSync(tmpPath, this.filePath);
    try {
      fs.chmodSync(this.filePath, 0o600);
    } catch {
      // Best effort: not all platforms support chmod.
    }
    logger.info('Configuration persisted', { filePath: this.filePath });
  }

  private loadKey(secret?: string): Buffer {
    if (secret) {
      return crypto.scryptSync(secret, KEY_DERIVATION_SALT, 32);
    }
    const keyPath = `${this.filePath}.key`;
    if (fs.existsSync(keyPath)) {
      return Buffer.from(fs.readFileSync(keyPath, 'utf8').trim(), 'hex');
    }
    const key = crypto.randomBytes(32);
    fs.ensureDirSync(path.dirname(keyPath));
    fs.writeFileSync(keyPath, key.toString('hex'), { mode: 0o600 });
    logger.info('Generated configuration encryption key', { keyPath });
    return key;
  }

  private encryptConfig(config: CatalogConfig): CatalogConfig {
    const encrypted: any = {
      ...config,
      prestashop: { ...config.prestashop }
    };
    if (encrypted.prestashop.api_key) {
      encrypted.prestashop.api_key = this.encryptValue(encrypted.prestashop.api_key);
    }
    if (config.ai) {
      encrypted.ai = this.encryptAI(config.ai);
    }
    return encrypted as CatalogConfig;
  }

  private encryptAI(ai: AIConfig): AIConfig {
    const providers: Partial<Record<AIProviderName, AIProviderSettings>> = {};
    for (const [name, settings] of Object.entries(ai.providers ?? {})) {
      if (!settings) continue;
      providers[name as AIProviderName] = {
        ...settings,
        ...(settings.api_key ? { api_key: this.encryptValue(settings.api_key) } : {})
      } as AIProviderSettings;
    }
    const encrypted: any = { ...ai, providers };
    if (ai.api_key) {
      encrypted.api_key = this.encryptValue(ai.api_key);
    }
    return encrypted as AIConfig;
  }

  private decryptConfig(config: CatalogConfig): CatalogConfig {
    const prestashop = { ...config.prestashop };
    if (this.isEncrypted(prestashop.api_key)) {
      prestashop.api_key = this.decryptValue(prestashop.api_key as unknown as EncryptedValue);
    }
    let ai = config.ai;
    if (ai) ai = this.decryptAI(ai);
    return { ...config, prestashop, ai };
  }

  private decryptAI(ai: AIConfig): AIConfig {
    const providers: Partial<Record<AIProviderName, AIProviderSettings>> = {};
    for (const [name, settings] of Object.entries(ai.providers ?? {})) {
      if (!settings) continue;
      providers[name as AIProviderName] = {
        ...settings,
        ...(this.isEncrypted(settings.api_key)
          ? { api_key: this.decryptValue(settings.api_key as unknown as EncryptedValue) }
          : {})
      } as AIProviderSettings;
    }
    const decrypted: any = { ...ai, providers };
    if (this.isEncrypted(ai.api_key)) {
      decrypted.api_key = this.decryptValue(ai.api_key as unknown as EncryptedValue);
    }
    return decrypted as AIConfig;
  }

  private encryptValue(value: string): EncryptedValue {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
      [ENCRYPTION_MARKER]: true,
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
      data: data.toString('base64')
    };
  }

  private decryptValue(value: EncryptedValue): string {
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, Buffer.from(value.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(value.data, 'base64')), decipher.final()]).toString('utf8');
  }

  private isEncrypted(value: any): boolean {
    return Boolean(value) && typeof value === 'object' && value[ENCRYPTION_MARKER] === true;
  }
}
