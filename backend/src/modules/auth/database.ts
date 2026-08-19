// SQLite multi-tenant database backed by sql.js (pure WASM, zero native deps).
// Every configuration table is scoped by comercio_id so shops are fully isolated.
// Persists to disk on every write so data survives server restarts.

import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import fs from 'fs';
import path from 'path';
import { logger } from '../../utils/logger';
import { AIProviderName } from '../../types';

let db: SqlJsDatabase;
let dbPath: string;

// ── Schema ───────────────────────────────────────────────────────────────────

const SCHEMA = `
  PRAGMA foreign_keys = ON;

  -- Comercios (tenants)
  CREATE TABLE IF NOT EXISTS comercios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  -- Users (belong to a comercio)
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin', 'user')),
    comercio_id INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (comercio_id) REFERENCES comercios(id) ON DELETE CASCADE,
    UNIQUE(username, comercio_id)
  );

  CREATE TABLE IF NOT EXISTS login_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    comercio_slug TEXT,
    ip_address TEXT,
    attempted_at TEXT DEFAULT (datetime('now')),
    success INTEGER DEFAULT 0
  );

  -- Marketplaces available per comercio
  CREATE TABLE IF NOT EXISTS marketplaces (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    comercio_id INTEGER NOT NULL,
    enabled INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (comercio_id) REFERENCES comercios(id) ON DELETE CASCADE,
    UNIQUE(slug, comercio_id)
  );

  -- AI Providers available per comercio
  CREATE TABLE IF NOT EXISTS ai_providers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    comercio_id INTEGER NOT NULL,
    enabled INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (comercio_id) REFERENCES comercios(id) ON DELETE CASCADE,
    UNIQUE(slug, comercio_id)
  );

  -- Marketplace configuration (key-value, FK to marketplaces)
  CREATE TABLE IF NOT EXISTS marketplace_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    marketplace_id INTEGER NOT NULL,
    config_key TEXT NOT NULL,
    config_value TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (marketplace_id) REFERENCES marketplaces(id) ON DELETE CASCADE,
    UNIQUE(marketplace_id, config_key)
  );

  -- AI Provider configuration (key-value, FK to ai_providers)
  CREATE TABLE IF NOT EXISTS ai_provider_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ai_provider_id INTEGER NOT NULL,
    config_key TEXT NOT NULL,
    config_value TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (ai_provider_id) REFERENCES ai_providers(id) ON DELETE CASCADE,
    UNIQUE(ai_provider_id, config_key)
  );

  -- App-level settings per comercio (active marketplace, active AI provider, etc.)
  CREATE TABLE IF NOT EXISTS app_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    comercio_id INTEGER NOT NULL,
    setting_key TEXT NOT NULL,
    setting_value TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (comercio_id) REFERENCES comercios(id) ON DELETE CASCADE,
    UNIQUE(comercio_id, setting_key)
  );
`;

const SEED_MARKETPLACES = [
  { name: 'PrestaShop', slug: 'prestashop' }
];

const SEED_AI_PROVIDERS = [
  { name: 'Mock', slug: 'mock' },
  { name: 'OpenAI', slug: 'openai' },
  { name: 'Anthropic', slug: 'anthropic' },
  { name: 'GPT4All', slug: 'gpt4all' }
];

const DEFAULT_APP_SETTINGS: Record<string, string> = {
  active_marketplace: 'prestashop',
  active_ai_provider: 'mock'
};

// ── Initialization ───────────────────────────────────────────────────────────

export async function initDatabase(dataDir: string): Promise<SqlJsDatabase> {
  const SQL = await initSqlJs();
  dbPath = path.join(dataDir, 'catalogai.db');

  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    db = new SQL.Database(buffer);
    logger.info('Loaded database', { path: dbPath });
  } else {
    db = new SQL.Database();
    logger.info('Created new database', { path: dbPath });
  }

  db.run('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);

  persist();
  return db;
}

export function getDatabase(): SqlJsDatabase {
  if (!db) throw new Error('Database not initialized – call initDatabase() first');
  return db;
}

export function persist(): void {
  if (!db || !dbPath) return;
  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(dbPath, buffer);
  } catch (error) {
    logger.error('Failed to persist database', {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

// ── Generic helpers ──────────────────────────────────────────────────────────

function queryAll(sql: string, params: any[] = []): Record<string, any>[] {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows: Record<string, any>[] = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function queryOne(sql: string, params: any[] = []): Record<string, any> | undefined {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  let row: Record<string, any> | undefined;
  if (stmt.step()) {
    row = stmt.getAsObject();
  }
  stmt.free();
  return row;
}

// ── Comercios ────────────────────────────────────────────────────────────────

export interface ComercioRow {
  id: number;
  name: string;
  slug: string;
  created_at: string;
  updated_at: string;
}

export function createComercio(name: string, slug: string): ComercioRow {
  db.run('INSERT INTO comercios (name, slug) VALUES (?, ?)', [name, slug]);
  // Seed default marketplaces and AI providers for this comercio
  for (const mp of SEED_MARKETPLACES) {
    db.run('INSERT INTO marketplaces (name, slug, comercio_id) VALUES (?, ?, last_insert_rowid())', [mp.name, mp.slug]);
  }
  for (const prov of SEED_AI_PROVIDERS) {
    db.run('INSERT INTO ai_providers (name, slug, comercio_id) VALUES (?, ?, last_insert_rowid())', [prov.name, prov.slug]);
  }
  // Seed default app settings
  const comercioId = queryOne('SELECT last_insert_rowid() as id')?.id;
  if (comercioId) {
    for (const [key, value] of Object.entries(DEFAULT_APP_SETTINGS)) {
      db.run('INSERT INTO app_settings (comercio_id, setting_key, setting_value) VALUES (?, ?, ?)', [comercioId, key, value]);
    }
  }
  persist();
  const row = queryOne('SELECT id, name, slug, created_at, updated_at FROM comercios WHERE slug = ?', [slug]);
  logger.info('Comercio created', { name, slug });
  return row as ComercioRow;
}

export function findComercioBySlug(slug: string): ComercioRow | undefined {
  return queryOne('SELECT id, name, slug, created_at, updated_at FROM comercios WHERE slug = ?', [slug]) as ComercioRow | undefined;
}

export function findComercioById(id: number): ComercioRow | undefined {
  return queryOne('SELECT id, name, slug, created_at, updated_at FROM comercios WHERE id = ?', [id]) as ComercioRow | undefined;
}

export function listComercios(): ComercioRow[] {
  return queryAll('SELECT id, name, slug, created_at, updated_at FROM comercios ORDER BY id') as unknown as ComercioRow[];
}

export function deleteComercio(id: number): void {
  db.run('DELETE FROM comercios WHERE id = ?', [id]);
  persist();
  logger.info('Comercio deleted', { id });
}

// ── Users ────────────────────────────────────────────────────────────────────

export interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  role: 'admin' | 'user';
  comercio_id: number;
  created_at: string;
  updated_at: string;
}

export function findUserByUsername(username: string, comercioId: number): UserRow | undefined {
  return queryOne(
    'SELECT id, username, password_hash, role, comercio_id, created_at, updated_at FROM users WHERE username = ? AND comercio_id = ?',
    [username, comercioId]
  ) as UserRow | undefined;
}

export function findUserByUsernameGlobal(username: string): UserRow | undefined {
  return queryOne(
    'SELECT id, username, password_hash, role, comercio_id, created_at, updated_at FROM users WHERE username = ?',
    [username]
  ) as UserRow | undefined;
}

export function findUserById(id: number): UserRow | undefined {
  return queryOne(
    'SELECT id, username, password_hash, role, comercio_id, created_at, updated_at FROM users WHERE id = ?',
    [id]
  ) as UserRow | undefined;
}

export function listUsers(comercioId: number): Omit<UserRow, 'password_hash'>[] {
  return queryAll(
    'SELECT id, username, role, comercio_id, created_at, updated_at FROM users WHERE comercio_id = ? ORDER BY id',
    [comercioId]
  ) as unknown as Omit<UserRow, 'password_hash'>[];
}

export function createUser(username: string, passwordHash: string, role: 'admin' | 'user', comercioId: number): UserRow {
  db.run('INSERT INTO users (username, password_hash, role, comercio_id) VALUES (?, ?, ?, ?)', [username, passwordHash, role, comercioId]);
  persist();
  const user = findUserByUsername(username, comercioId);
  if (!user) throw new Error('Failed to create user');
  logger.info('User created', { username, role, comercioId });
  return user;
}

export function updateUser(id: number, fields: { password_hash?: string; role?: 'admin' | 'user' }): void {
  const sets: string[] = ['updated_at = datetime(\'now\')'];
  const values: any[] = [];
  if (fields.password_hash) {
    sets.push('password_hash = ?');
    values.push(fields.password_hash);
  }
  if (fields.role) {
    sets.push('role = ?');
    values.push(fields.role);
  }
  values.push(id);
  db.run(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, values);
  persist();
  logger.info('User updated', { id });
}

export function deleteUser(id: number): void {
  db.run('DELETE FROM users WHERE id = ?', [id]);
  persist();
  logger.info('User deleted', { id });
}

// ── Login attempts ───────────────────────────────────────────────────────────

const MAX_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

export function recordLoginAttempt(username: string, comercioSlug: string | undefined, ip: string | undefined, success: boolean): void {
  db.run('INSERT INTO login_attempts (username, comercio_slug, ip_address, success) VALUES (?, ?, ?, ?)', [
    username,
    comercioSlug ?? '',
    ip ?? '',
    success ? 1 : 0
  ]);
  persist();
}

export function isAccountLocked(username: string): boolean {
  const row = queryOne(`
    SELECT COUNT(*) as cnt FROM login_attempts
    WHERE username = ? AND success = 0
    AND attempted_at > datetime('now', '-' || ? || ' minutes')
  `, [username, String(LOCKOUT_MINUTES)]);
  return row ? (row.cnt as number) >= MAX_ATTEMPTS : false;
}

// ── Marketplaces (scoped by comercio) ────────────────────────────────────────

export interface MarketplaceRow {
  id: number;
  name: string;
  slug: string;
  comercio_id: number;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export function listMarketplaces(comercioId: number): MarketplaceRow[] {
  return queryAll(
    'SELECT id, name, slug, comercio_id, enabled, created_at, updated_at FROM marketplaces WHERE comercio_id = ? ORDER BY id',
    [comercioId]
  ) as unknown as MarketplaceRow[];
}

export function findMarketplaceBySlug(slug: string, comercioId: number): MarketplaceRow | undefined {
  return queryOne(
    'SELECT id, name, slug, comercio_id, enabled, created_at, updated_at FROM marketplaces WHERE slug = ? AND comercio_id = ?',
    [slug, comercioId]
  ) as MarketplaceRow | undefined;
}

// ── AI Providers (scoped by comercio) ────────────────────────────────────────

export interface AIProviderRow {
  id: number;
  name: string;
  slug: string;
  comercio_id: number;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export function listAIProviders(comercioId: number): AIProviderRow[] {
  return queryAll(
    'SELECT id, name, slug, comercio_id, enabled, created_at, updated_at FROM ai_providers WHERE comercio_id = ? ORDER BY id',
    [comercioId]
  ) as unknown as AIProviderRow[];
}

export function findAIProviderBySlug(slug: string, comercioId: number): AIProviderRow | undefined {
  return queryOne(
    'SELECT id, name, slug, comercio_id, enabled, created_at, updated_at FROM ai_providers WHERE slug = ? AND comercio_id = ?',
    [slug, comercioId]
  ) as AIProviderRow | undefined;
}

// ── Marketplace config (scoped by comercio via marketplace FK) ───────────────

export function getMarketplaceConfig(marketplaceSlug: string, comercioId: number): Record<string, string> {
  const rows = queryAll(`
    SELECT mc.config_key, mc.config_value
    FROM marketplace_config mc
    JOIN marketplaces m ON m.id = mc.marketplace_id
    WHERE m.slug = ? AND m.comercio_id = ?
  `, [marketplaceSlug, comercioId]);
  const config: Record<string, string> = {};
  for (const row of rows) {
    config[row.config_key as string] = row.config_value as string;
  }
  return config;
}

export function setMarketplaceConfigBatch(marketplaceSlug: string, comercioId: number, config: Record<string, string>): void {
  const mp = findMarketplaceBySlug(marketplaceSlug, comercioId);
  if (!mp) throw new Error(`Marketplace not found: ${marketplaceSlug}`);

  for (const [key, value] of Object.entries(config)) {
    db.run(`
      INSERT INTO marketplace_config (marketplace_id, config_key, config_value)
      VALUES (?, ?, ?)
      ON CONFLICT(marketplace_id, config_key) DO UPDATE SET
        config_value = excluded.config_value,
        updated_at = datetime('now')
    `, [mp.id, key, value]);
  }
  persist();
}

// ── AI Provider config (scoped by comercio via ai_provider FK) ───────────────

export function getAIProviderConfig(providerSlug: string, comercioId: number): Record<string, string> {
  const rows = queryAll(`
    SELECT apc.config_key, apc.config_value
    FROM ai_provider_config apc
    JOIN ai_providers ap ON ap.id = apc.ai_provider_id
    WHERE ap.slug = ? AND ap.comercio_id = ?
  `, [providerSlug, comercioId]);
  const config: Record<string, string> = {};
  for (const row of rows) {
    config[row.config_key as string] = row.config_value as string;
  }
  return config;
}

export function setAIProviderConfigBatch(providerSlug: string, comercioId: number, config: Record<string, string>): void {
  const prov = findAIProviderBySlug(providerSlug, comercioId);
  if (!prov) throw new Error(`AI provider not found: ${providerSlug}`);

  for (const [key, value] of Object.entries(config)) {
    db.run(`
      INSERT INTO ai_provider_config (ai_provider_id, config_key, config_value)
      VALUES (?, ?, ?)
      ON CONFLICT(ai_provider_id, config_key) DO UPDATE SET
        config_value = excluded.config_value,
        updated_at = datetime('now')
    `, [prov.id, key, value]);
  }
  persist();
}

// ── App settings (scoped by comercio) ────────────────────────────────────────

export function getAppSetting(comercioId: number, key: string): string | undefined {
  const row = queryOne(
    'SELECT setting_value FROM app_settings WHERE comercio_id = ? AND setting_key = ?',
    [comercioId, key]
  );
  return row?.setting_value as string | undefined;
}

export function setAppSetting(comercioId: number, key: string, value: string): void {
  db.run(`
    INSERT INTO app_settings (comercio_id, setting_key, setting_value)
    VALUES (?, ?, ?)
    ON CONFLICT(comercio_id, setting_key) DO UPDATE SET
      setting_value = excluded.setting_value,
      updated_at = datetime('now')
  `, [comercioId, key, value]);
  persist();
}
