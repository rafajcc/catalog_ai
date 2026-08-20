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

const SCHEMA_VERSION = 3;

const SCHEMA = `
  PRAGMA foreign_keys = ON;

  -- Schema version tracking
  CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER NOT NULL
  );

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

  -- Global marketplaces (shared across all comercios)
  CREATE TABLE IF NOT EXISTS marketplaces (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    slug TEXT UNIQUE NOT NULL
  );

  -- Global AI providers (shared across all comercios)
  CREATE TABLE IF NOT EXISTS ai_providers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    slug TEXT UNIQUE NOT NULL
  );

  -- Per-comercio marketplace enablement
  CREATE TABLE IF NOT EXISTS comercio_marketplaces (
    comercio_id INTEGER NOT NULL,
    marketplace_id INTEGER NOT NULL,
    enabled INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (comercio_id, marketplace_id),
    FOREIGN KEY (comercio_id) REFERENCES comercios(id) ON DELETE CASCADE,
    FOREIGN KEY (marketplace_id) REFERENCES marketplaces(id) ON DELETE CASCADE
  );

  -- Per-comercio AI provider enablement
  CREATE TABLE IF NOT EXISTS comercio_ai_providers (
    comercio_id INTEGER NOT NULL,
    ai_provider_id INTEGER NOT NULL,
    enabled INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (comercio_id, ai_provider_id),
    FOREIGN KEY (comercio_id) REFERENCES comercios(id) ON DELETE CASCADE,
    FOREIGN KEY (ai_provider_id) REFERENCES ai_providers(id) ON DELETE CASCADE
  );

  -- Marketplace configuration (key-value, scoped by comercio + marketplace slug)
  CREATE TABLE IF NOT EXISTS marketplace_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    comercio_id INTEGER NOT NULL,
    marketplace_slug TEXT NOT NULL,
    config_key TEXT NOT NULL,
    config_value TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (comercio_id) REFERENCES comercios(id) ON DELETE CASCADE,
    UNIQUE(comercio_id, marketplace_slug, config_key)
  );

  -- AI Provider configuration (key-value, scoped by comercio + provider slug)
  CREATE TABLE IF NOT EXISTS ai_provider_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    comercio_id INTEGER NOT NULL,
    provider_slug TEXT NOT NULL,
    config_key TEXT NOT NULL,
    config_value TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (comercio_id) REFERENCES comercios(id) ON DELETE CASCADE,
    UNIQUE(comercio_id, provider_slug, config_key)
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

  // Check schema version — recreate if outdated
  const needsRecreate = !hasCorrectSchema();
  if (needsRecreate) {
    logger.warn('Database schema outdated or missing — recreating');
    db.close();
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    db = new SQL.Database();
    db.run('PRAGMA foreign_keys = ON;');
  }

  db.exec(SCHEMA);

  // Seed global marketplace and AI provider rows (idempotent)
  for (const mp of SEED_MARKETPLACES) {
    db.run('INSERT OR IGNORE INTO marketplaces (name, slug) VALUES (?, ?)', [mp.name, mp.slug]);
  }
  for (const prov of SEED_AI_PROVIDERS) {
    db.run('INSERT OR IGNORE INTO ai_providers (name, slug) VALUES (?, ?)', [prov.name, prov.slug]);
  }

  // Set or update schema version
  const existingVersion = queryOne('SELECT version FROM schema_version');
  if (!existingVersion) {
    db.run('INSERT INTO schema_version (version) VALUES (?)', [SCHEMA_VERSION]);
  } else if ((existingVersion.version as number) < SCHEMA_VERSION) {
    db.run('UPDATE schema_version SET version = ?', [SCHEMA_VERSION]);
  }

  persist();
  return db;
}

function hasCorrectSchema(): boolean {
  try {
    // Check that junction tables exist (v3 schema)
    const hasJunction = queryOne("SELECT name FROM sqlite_master WHERE type='table' AND name='comercio_marketplaces'");
    // Check that schema_version table exists and has current version
    const ver = queryOne('SELECT version FROM schema_version');
    const isCurrent = ver && (ver.version as number) >= SCHEMA_VERSION;
    return hasJunction && isCurrent;
  } catch {
    return false;
  }
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
  const comercioId = queryOne('SELECT last_insert_rowid() as id')?.id as number;

  // Enable all global marketplaces for this comercio
  for (const mp of SEED_MARKETPLACES) {
    db.run(`
      INSERT INTO comercio_marketplaces (comercio_id, marketplace_id, enabled)
      SELECT ?, id, 1 FROM marketplaces WHERE slug = ?
    `, [comercioId, mp.slug]);
  }

  // Enable all global AI providers for this comercio
  for (const prov of SEED_AI_PROVIDERS) {
    db.run(`
      INSERT INTO comercio_ai_providers (comercio_id, ai_provider_id, enabled)
      SELECT ?, id, 1 FROM ai_providers WHERE slug = ?
    `, [comercioId, prov.slug]);
  }

  // Seed default app settings
  db.run('INSERT INTO app_settings (comercio_id, setting_key, setting_value) VALUES (?, ?, ?)', [comercioId, 'active_marketplace', 'prestashop']);
  db.run('INSERT INTO app_settings (comercio_id, setting_key, setting_value) VALUES (?, ?, ?)', [comercioId, 'active_ai_provider', 'mock']);

  persist();
  const row = queryOne('SELECT id, name, slug, created_at, updated_at FROM comercios WHERE slug = ?', [slug]);
  logger.info('Comercio created', { name, slug });
  return row as ComercioRow;
}

export function findComercioBySlug(slug: string): ComercioRow | undefined {
  return queryOne('SELECT id, name, slug, created_at, updated_at FROM comercios WHERE slug = ?', [slug]) as ComercioRow | undefined;
}

export function findComercioByName(name: string): ComercioRow | undefined {
  return queryOne('SELECT id, name, slug, created_at, updated_at FROM comercios WHERE name = ?', [name]) as ComercioRow | undefined;
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

// ── Marketplaces (global + per-comercio enablement) ──────────────────────────

export interface MarketplaceRow {
  id: number;
  name: string;
  slug: string;
  enabled: number;
}

export function listMarketplaces(comercioId: number): MarketplaceRow[] {
  return queryAll(`
    SELECT m.id, m.name, m.slug, cm.enabled
    FROM marketplaces m
    JOIN comercio_marketplaces cm ON cm.marketplace_id = m.id
    WHERE cm.comercio_id = ?
    ORDER BY m.id
  `, [comercioId]) as unknown as MarketplaceRow[];
}

export function findMarketplaceBySlug(slug: string, comercioId: number): MarketplaceRow | undefined {
  return queryOne(`
    SELECT m.id, m.name, m.slug, cm.enabled
    FROM marketplaces m
    JOIN comercio_marketplaces cm ON cm.marketplace_id = m.id
    WHERE m.slug = ? AND cm.comercio_id = ?
  `, [slug, comercioId]) as MarketplaceRow | undefined;
}

// ── AI Providers (global + per-comercio enablement) ─────────────────────────

export interface AIProviderRow {
  id: number;
  name: string;
  slug: string;
  enabled: number;
}

export function listAIProviders(comercioId: number): AIProviderRow[] {
  return queryAll(`
    SELECT ap.id, ap.name, ap.slug, cap.enabled
    FROM ai_providers ap
    JOIN comercio_ai_providers cap ON cap.ai_provider_id = ap.id
    WHERE cap.comercio_id = ?
    ORDER BY ap.id
  `, [comercioId]) as unknown as AIProviderRow[];
}

export function findAIProviderBySlug(slug: string, comercioId: number): AIProviderRow | undefined {
  return queryOne(`
    SELECT ap.id, ap.name, ap.slug, cap.enabled
    FROM ai_providers ap
    JOIN comercio_ai_providers cap ON cap.ai_provider_id = ap.id
    WHERE ap.slug = ? AND cap.comercio_id = ?
  `, [slug, comercioId]) as AIProviderRow | undefined;
}

// ── Marketplace config (scoped by comercio + marketplace slug) ───────────────

export function getMarketplaceConfig(marketplaceSlug: string, comercioId: number): Record<string, string> {
  const rows = queryAll(`
    SELECT config_key, config_value
    FROM marketplace_config
    WHERE comercio_id = ? AND marketplace_slug = ?
  `, [comercioId, marketplaceSlug]);
  const config: Record<string, string> = {};
  for (const row of rows) {
    config[row.config_key as string] = row.config_value as string;
  }
  return config;
}

export function setMarketplaceConfigBatch(marketplaceSlug: string, comercioId: number, config: Record<string, string>): void {
  for (const [key, value] of Object.entries(config)) {
    db.run(`
      INSERT INTO marketplace_config (comercio_id, marketplace_slug, config_key, config_value)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(comercio_id, marketplace_slug, config_key) DO UPDATE SET
        config_value = excluded.config_value,
        updated_at = datetime('now')
    `, [comercioId, marketplaceSlug, key, value]);
  }
  persist();
}

// ── AI Provider config (scoped by comercio + provider slug) ──────────────────

export function getAIProviderConfig(providerSlug: string, comercioId: number): Record<string, string> {
  const rows = queryAll(`
    SELECT config_key, config_value
    FROM ai_provider_config
    WHERE comercio_id = ? AND provider_slug = ?
  `, [comercioId, providerSlug]);
  const config: Record<string, string> = {};
  for (const row of rows) {
    config[row.config_key as string] = row.config_value as string;
  }
  return config;
}

export function setAIProviderConfigBatch(providerSlug: string, comercioId: number, config: Record<string, string>): void {
  for (const [key, value] of Object.entries(config)) {
    db.run(`
      INSERT INTO ai_provider_config (comercio_id, provider_slug, config_key, config_value)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(comercio_id, provider_slug, config_key) DO UPDATE SET
        config_value = excluded.config_value,
        updated_at = datetime('now')
    `, [comercioId, providerSlug, key, value]);
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
