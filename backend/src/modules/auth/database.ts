// SQLite multi-tenant database backed by sql.js (pure WASM, zero native deps).
// Every configuration table is scoped by comercio_id so shops are fully isolated.
// Persists to disk on every write so data survives server restarts.

import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import fs from 'fs';
import path from 'path';
import { logger } from '../../utils/logger';

let db: SqlJsDatabase;
let dbPath: string;

// ── Schema ───────────────────────────────────────────────────────────────────

const SCHEMA_VERSION = 6;

const SCHEMA = `
  PRAGMA foreign_keys = ON;

  -- Schema version tracking
  CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER NOT NULL
  );

  -- Comercios (tenants). A comercio can be disabled by the super admin; while
  -- disabled its users can neither log in nor perform any action.
  CREATE TABLE IF NOT EXISTS comercios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  -- Users (belong to a comercio). must_change_password forces the user to pick
  -- a new password on the next login (used when the password was handed over
  -- by an admin or the super admin instead of being chosen by the user).
  -- active can be flipped off by the comercio admin or the super admin; a
  -- disabled user cannot log in and its open sessions die immediately.
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin', 'user')),
    comercio_id INTEGER NOT NULL,
    must_change_password INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (comercio_id) REFERENCES comercios(id) ON DELETE CASCADE,
    UNIQUE(username, comercio_id)
  );

  CREATE TABLE IF NOT EXISTS login_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    ip_address TEXT,
    attempted_at TEXT DEFAULT (datetime('now')),
    success INTEGER DEFAULT 0
  );

  -- Global marketplaces (shared across all comercios)
  CREATE TABLE IF NOT EXISTS marketplaces (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL
  );

  -- Global AI providers (shared across all comercios)
  CREATE TABLE IF NOT EXISTS ai_providers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL
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

  -- Marketplace configuration (key-value, FK to marketplaces + comercio)
  CREATE TABLE IF NOT EXISTS marketplace_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    comercio_id INTEGER NOT NULL,
    marketplace_id INTEGER NOT NULL,
    config_key TEXT NOT NULL,
    config_value TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (comercio_id) REFERENCES comercios(id) ON DELETE CASCADE,
    FOREIGN KEY (marketplace_id) REFERENCES marketplaces(id) ON DELETE CASCADE,
    UNIQUE(comercio_id, marketplace_id, config_key)
  );

  -- AI Provider configuration (key-value, FK to ai_providers + comercio)
  CREATE TABLE IF NOT EXISTS ai_provider_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    comercio_id INTEGER NOT NULL,
    ai_provider_id INTEGER NOT NULL,
    config_key TEXT NOT NULL,
    config_value TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (comercio_id) REFERENCES comercios(id) ON DELETE CASCADE,
    FOREIGN KEY (ai_provider_id) REFERENCES ai_providers(id) ON DELETE CASCADE,
    UNIQUE(comercio_id, ai_provider_id, config_key)
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

  -- Global image provider services (configured by the super admin, shared by
  -- every comercio). One row per service: it carries the credentials/config as
  -- JSON, the billing-cycle counters and the round-robin "last called" marker.
  CREATE TABLE IF NOT EXISTS image_providers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 0,
    config TEXT NOT NULL DEFAULT '{}',
    billing_cycle_day INTEGER,
    calls_this_cycle INTEGER NOT NULL DEFAULT 0,
    cycle_start TEXT,
    last_called INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  -- Product images loaded by the super admin from provider feeds. Looked up in
  -- three levels of specificity: brand+reference+ean, then brand+reference,
  -- then brand+ean. A product may have several images for the same triple.
  CREATE TABLE IF NOT EXISTS provider_feed_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    brand TEXT NOT NULL,
    reference TEXT,
    ean TEXT,
    image_url TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_provider_feed_images_brand_ref_ean
    ON provider_feed_images (brand, reference, ean);
`;

const SEED_MARKETPLACES = [
  { name: 'PrestaShop' }
];

const SEED_AI_PROVIDERS = [
  { name: 'anthropic' },
  { name: 'mock' },
  { name: 'openai' },
  { name: 'openrouter' }
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

  // Run idempotent schema — CREATE TABLE IF NOT EXISTS never destroys data
  db.exec(SCHEMA);

  // Migrations for databases created before schema version 4: the comercios
  // and users tables gain the new columns. The ALTER TABLEs are guarded by a
  // column check so they are idempotent (and no-ops on fresh databases that
  // were created with the new schema).
  if (!hasColumn('comercios', 'active')) {
    db.run('ALTER TABLE comercios ADD COLUMN active INTEGER NOT NULL DEFAULT 1');
  }
  if (!hasColumn('users', 'must_change_password')) {
    db.run('ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0');
  }
  if (!hasColumn('users', 'active')) {
    db.run('ALTER TABLE users ADD COLUMN active INTEGER NOT NULL DEFAULT 1');
  }

  // Seed global marketplace and AI provider rows (idempotent)
  for (const mp of SEED_MARKETPLACES) {
    db.run('INSERT OR IGNORE INTO marketplaces (name) VALUES (?)', [mp.name]);
  }
  for (const prov of SEED_AI_PROVIDERS) {
    db.run('INSERT OR IGNORE INTO ai_providers (name) VALUES (?)', [prov.name]);
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

function hasColumn(table: string, column: string): boolean {
  const rows = queryAll(`PRAGMA table_info(${table})`);
  return rows.some((row) => row.name === column);
}

// ── Comercios ────────────────────────────────────────────────────────────────

export interface ComercioRow {
  id: number;
  name: string;
  active: 0 | 1;
  created_at: string;
  updated_at: string;
}

export function createComercio(name: string): ComercioRow {
  db.run('INSERT INTO comercios (name) VALUES (?)', [name]);
  const comercioId = queryOne('SELECT last_insert_rowid() as id')?.id as number;

  // Enable all global marketplaces for this comercio
  for (const mp of SEED_MARKETPLACES) {
    db.run(`
      INSERT INTO comercio_marketplaces (comercio_id, marketplace_id, enabled)
      SELECT ?, id, 1 FROM marketplaces WHERE name = ?
    `, [comercioId, mp.name]);
  }

  // Enable all global AI providers for this comercio
  for (const prov of SEED_AI_PROVIDERS) {
    db.run(`
      INSERT INTO comercio_ai_providers (comercio_id, ai_provider_id, enabled)
      SELECT ?, id, 1 FROM ai_providers WHERE name = ?
    `, [comercioId, prov.name]);
  }

  // Seed default app settings
  db.run('INSERT INTO app_settings (comercio_id, setting_key, setting_value) VALUES (?, ?, ?)', [comercioId, 'active_marketplace', 'PrestaShop']);
  db.run('INSERT INTO app_settings (comercio_id, setting_key, setting_value) VALUES (?, ?, ?)', [comercioId, 'active_ai_provider', 'mock']);

  persist();
  const row = queryOne('SELECT id, name, active, created_at, updated_at FROM comercios WHERE id = ?', [comercioId]);
  logger.info('Comercio created', { name, id: comercioId });
  return row as ComercioRow;
}

export function findComercioByName(name: string): ComercioRow | undefined {
  return queryOne('SELECT id, name, active, created_at, updated_at FROM comercios WHERE name = ?', [name]) as ComercioRow | undefined;
}

export function findComercioById(id: number): ComercioRow | undefined {
  return queryOne('SELECT id, name, active, created_at, updated_at FROM comercios WHERE id = ?', [id]) as ComercioRow | undefined;
}

export function deleteComercio(id: number): void {
  db.run('DELETE FROM comercios WHERE id = ?', [id]);
  persist();
  logger.info('Comercio deleted', { id });
}

// Lists every registered comercio (super admin). Never used by a comercio-bound
// endpoint, so no cross-tenant information leaks to regular users.
export function listComercios(): ComercioRow[] {
  return queryAll('SELECT id, name, active, created_at, updated_at FROM comercios ORDER BY id') as unknown as ComercioRow[];
}

// Enables or disables a comercio. Returns false when the comercio does not
// exist, true otherwise.
export function setComercioActive(id: number, active: boolean): boolean {
  const updated = db.run('UPDATE comercios SET active = ?, updated_at = datetime(\'now\') WHERE id = ?', [active ? 1 : 0, id]);
  if (updated.changes === 0) return false;
  persist();
  logger.info('Comercio active state changed', { id, active });
  return true;
}

// Number of users registered on a comercio (super admin listing).
export function countUsers(comercioId: number): number {
  const row = queryOne('SELECT COUNT(*) as cnt FROM users WHERE comercio_id = ?', [comercioId]);
  return row ? (row.cnt as number) : 0;
}

// ── Users ────────────────────────────────────────────────────────────────────

export interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  role: 'admin' | 'user';
  comercio_id: number;
  must_change_password: 0 | 1;
  active: 0 | 1;
  created_at: string;
  updated_at: string;
}

export function findUserByUsername(username: string, comercioId: number): UserRow | undefined {
  return queryOne(
    'SELECT id, username, password_hash, role, comercio_id, must_change_password, active, created_at, updated_at FROM users WHERE username = ? AND comercio_id = ?',
    [username, comercioId]
  ) as UserRow | undefined;
}

export function findUserByUsernameGlobal(username: string): UserRow | undefined {
  return queryOne(
    'SELECT id, username, password_hash, role, comercio_id, must_change_password, active, created_at, updated_at FROM users WHERE username = ?',
    [username]
  ) as UserRow | undefined;
}

export function findUserById(id: number): UserRow | undefined {
  return queryOne(
    'SELECT id, username, password_hash, role, comercio_id, must_change_password, active, created_at, updated_at FROM users WHERE id = ?',
    [id]
  ) as UserRow | undefined;
}

export function listUsers(comercioId: number): Omit<UserRow, 'password_hash'>[] {
  return queryAll(
    'SELECT id, username, role, comercio_id, must_change_password, active, created_at, updated_at FROM users WHERE comercio_id = ? ORDER BY id',
    [comercioId]
  ) as unknown as Omit<UserRow, 'password_hash'>[];
}

// `mustChangePassword` marks a user whose password was chosen by somebody else
// (an admin or the super admin) and therefore must be changed on next login.
export function createUser(username: string, passwordHash: string, role: 'admin' | 'user', comercioId: number, mustChangePassword: boolean = false): UserRow {
  db.run('INSERT INTO users (username, password_hash, role, comercio_id, must_change_password) VALUES (?, ?, ?, ?, ?)', [username, passwordHash, role, comercioId, mustChangePassword ? 1 : 0]);
  persist();
  const user = findUserByUsername(username, comercioId);
  if (!user) throw new Error('Failed to create user');
  logger.info('User created', { username, role, comercioId, mustChangePassword });
  return user;
}

export function updateUser(id: number, fields: { password_hash?: string; role?: 'admin' | 'user'; must_change_password?: boolean; active?: boolean }): void {
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
  if (typeof fields.must_change_password === 'boolean') {
    sets.push('must_change_password = ?');
    values.push(fields.must_change_password ? 1 : 0);
  }
  if (typeof fields.active === 'boolean') {
    sets.push('active = ?');
    values.push(fields.active ? 1 : 0);
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

export function recordLoginAttempt(username: string, ip: string | undefined, success: boolean): void {
  db.run('INSERT INTO login_attempts (username, ip_address, success) VALUES (?, ?, ?)', [
    username,
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
  enabled: number;
}

export function listMarketplaces(comercioId: number): MarketplaceRow[] {
  return queryAll(`
    SELECT m.id, m.name, cm.enabled
    FROM marketplaces m
    JOIN comercio_marketplaces cm ON cm.marketplace_id = m.id
    WHERE cm.comercio_id = ?
    ORDER BY m.id
  `, [comercioId]) as unknown as MarketplaceRow[];
}

export function findMarketplaceById(id: number, comercioId: number): MarketplaceRow | undefined {
  return queryOne(`
    SELECT m.id, m.name, cm.enabled
    FROM marketplaces m
    JOIN comercio_marketplaces cm ON cm.marketplace_id = m.id
    WHERE m.id = ? AND cm.comercio_id = ?
  `, [id, comercioId]) as MarketplaceRow | undefined;
}

export function findMarketplaceByName(name: string, comercioId: number): MarketplaceRow | undefined {
  return queryOne(`
    SELECT m.id, m.name, cm.enabled
    FROM marketplaces m
    JOIN comercio_marketplaces cm ON cm.marketplace_id = m.id
    WHERE m.name = ? AND cm.comercio_id = ?
  `, [name, comercioId]) as MarketplaceRow | undefined;
}

// ── AI Providers (global + per-comercio enablement) ─────────────────────────

export interface AIProviderRow {
  id: number;
  name: string;
  enabled: number;
}

export function listAIProviders(comercioId: number): AIProviderRow[] {
  return queryAll(`
    SELECT ap.id, ap.name, cap.enabled
    FROM ai_providers ap
    JOIN comercio_ai_providers cap ON cap.ai_provider_id = ap.id
    WHERE cap.comercio_id = ?
    ORDER BY ap.id
  `, [comercioId]) as unknown as AIProviderRow[];
}

export function findAIProviderById(id: number, comercioId: number): AIProviderRow | undefined {
  return queryOne(`
    SELECT ap.id, ap.name, cap.enabled
    FROM ai_providers ap
    JOIN comercio_ai_providers cap ON cap.ai_provider_id = ap.id
    WHERE ap.id = ? AND cap.comercio_id = ?
  `, [id, comercioId]) as AIProviderRow | undefined;
}

export function findAIProviderByName(name: string, comercioId: number): AIProviderRow | undefined {
  return queryOne(`
    SELECT ap.id, ap.name, cap.enabled
    FROM ai_providers ap
    JOIN comercio_ai_providers cap ON cap.ai_provider_id = ap.id
    WHERE ap.name = ? AND cap.comercio_id = ?
  `, [name, comercioId]) as AIProviderRow | undefined;
}

// ── Marketplace config (scoped by comercio + marketplace FK) ────────────────

export function getMarketplaceConfig(marketplaceId: number, comercioId: number): Record<string, string> {
  const rows = queryAll(`
    SELECT config_key, config_value
    FROM marketplace_config
    WHERE comercio_id = ? AND marketplace_id = ?
  `, [comercioId, marketplaceId]);
  const config: Record<string, string> = {};
  for (const row of rows) {
    config[row.config_key as string] = row.config_value as string;
  }
  return config;
}

export function setMarketplaceConfigBatch(marketplaceId: number, comercioId: number, config: Record<string, string>): void {
  for (const [key, value] of Object.entries(config)) {
    db.run(`
      INSERT INTO marketplace_config (comercio_id, marketplace_id, config_key, config_value)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(comercio_id, marketplace_id, config_key) DO UPDATE SET
        config_value = excluded.config_value,
        updated_at = datetime('now')
    `, [comercioId, marketplaceId, key, value]);
  }
  persist();
}

// ── AI Provider config (scoped by comercio + provider FK) ───────────────────

export function getAIProviderConfig(providerId: number, comercioId: number): Record<string, string> {
  const rows = queryAll(`
    SELECT config_key, config_value
    FROM ai_provider_config
    WHERE comercio_id = ? AND ai_provider_id = ?
  `, [comercioId, providerId]);
  const config: Record<string, string> = {};
  for (const row of rows) {
    config[row.config_key as string] = row.config_value as string;
  }
  return config;
}

export function setAIProviderConfigBatch(providerId: number, comercioId: number, config: Record<string, string | null>): void {
  for (const [key, value] of Object.entries(config)) {
    if (value === null) {
      db.run(
        'DELETE FROM ai_provider_config WHERE comercio_id = ? AND ai_provider_id = ? AND config_key = ?',
        [comercioId, providerId, key]
      );
      continue;
    }
    db.run(`
      INSERT INTO ai_provider_config (comercio_id, ai_provider_id, config_key, config_value)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(comercio_id, ai_provider_id, config_key) DO UPDATE SET
        config_value = excluded.config_value,
        updated_at = datetime('now')
    `, [comercioId, providerId, key, value]);
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

// ── Image provider services (global, super admin) ────────────────────────────

export interface ImageProviderRow {
  id: number;
  slug: string;
  name: string;
  sort_order: number;
  enabled: 0 | 1;
  // JSON with the service credentials/options: api_key, username, password and
  // provider-specific extras (actor_id, zone, location_name, ...). Secrets are
  // never exposed to the API: the routes only report has_api_key flags.
  config: string;
  billing_cycle_day: number | null;
  calls_this_cycle: number;
  cycle_start: string | null;
  last_called: 0 | 1;
  created_at: string;
  updated_at: string;
}

const IMAGE_PROVIDER_COLUMNS =
  'id, slug, name, sort_order, enabled, config, billing_cycle_day, calls_this_cycle, cycle_start, last_called, created_at, updated_at';

export function listImageProviders(): ImageProviderRow[] {
  return queryAll(
    `SELECT ${IMAGE_PROVIDER_COLUMNS} FROM image_providers ORDER BY sort_order, id`
  ) as unknown as ImageProviderRow[];
}

export function getImageProviderBySlug(slug: string): ImageProviderRow | undefined {
  return queryOne(
    `SELECT ${IMAGE_PROVIDER_COLUMNS} FROM image_providers WHERE slug = ?`,
    [slug]
  ) as ImageProviderRow | undefined;
}

// Deletes a provider row (used to prune services that are no longer registered,
// e.g. the old decodo_standard). Returns false when the row does not exist.
export function deleteImageProvider(slug: string): boolean {
  const result = db.run('DELETE FROM image_providers WHERE slug = ?', [slug]);
  if (result.changes === 0) return false;
  persist();
  logger.info('Image provider deleted', { slug });
  return true;
}

// Seed/insert a provider row, keeping the existing row untouched when the slug
// already exists (idempotent seeding on startup).
export function upsertImageProvider(row: {
  slug: string;
  name: string;
  sort_order: number;
  enabled?: boolean;
  config?: Record<string, unknown>;
}): void {
  db.run(
    `INSERT OR IGNORE INTO image_providers (slug, name, sort_order, enabled, config)
     VALUES (?, ?, ?, ?, ?)`,
    [row.slug, row.name, row.sort_order, row.enabled ? 1 : 0, JSON.stringify(row.config ?? {})]
  );
}

// Updates any of the writable columns of a provider row. Undefined fields are
// untouched; null clears the column. Returns false when the row does not exist.
export function updateImageProvider(
  slug: string,
  fields: {
    name?: string;
    sort_order?: number;
    enabled?: boolean;
    config?: Record<string, unknown>;
    billing_cycle_day?: number | null;
    calls_this_cycle?: number;
    cycle_start?: string | null;
    last_called?: number;
  }
): boolean {
  const sets: string[] = ['updated_at = datetime(\'now\')'];
  const values: any[] = [];
  if (fields.name !== undefined) {
    sets.push('name = ?');
    values.push(fields.name);
  }
  if (fields.sort_order !== undefined) {
    sets.push('sort_order = ?');
    values.push(fields.sort_order);
  }
  if (fields.enabled !== undefined) {
    sets.push('enabled = ?');
    values.push(fields.enabled ? 1 : 0);
  }
  if (fields.config !== undefined) {
    sets.push('config = ?');
    values.push(JSON.stringify(fields.config));
  }
  if (fields.billing_cycle_day !== undefined) {
    sets.push('billing_cycle_day = ?');
    values.push(fields.billing_cycle_day);
  }
  if (fields.calls_this_cycle !== undefined) {
    sets.push('calls_this_cycle = ?');
    values.push(fields.calls_this_cycle);
  }
  if (fields.cycle_start !== undefined) {
    sets.push('cycle_start = ?');
    values.push(fields.cycle_start);
  }
  if (fields.last_called !== undefined) {
    sets.push('last_called = ?');
    values.push(fields.last_called);
  }
  if (sets.length === 1) return true;
  values.push(slug);
  const result = db.run(`UPDATE image_providers SET ${sets.join(', ')} WHERE slug = ?`, values);
  if (result.changes === 0) return false;
  persist();
  return true;
}

export function setImageProviderEnabled(slug: string, enabled: boolean): boolean {
  return updateImageProvider(slug, { enabled });
}

// The slug of the provider that made the last call of the round robin, or null
// when the app has not called any provider yet.
export function getLastCalledImageProvider(): string | null {
  const row = queryOne('SELECT slug FROM image_providers WHERE last_called = 1');
  return row ? (row.slug as string) : null;
}

// Marks the provider that just made a call as the round-robin cursor. Passing
// null clears the marker (used when no provider can be called).
export function setLastCalledImageProvider(slug: string | null): void {
  db.run('UPDATE image_providers SET last_called = 0');
  if (slug) {
    db.run('UPDATE image_providers SET last_called = 1, updated_at = datetime(\'now\') WHERE slug = ?', [slug]);
  }
  persist();
}

// Resets the billing-cycle counters of a provider (manual reset from the super
// admin panel, or when the cycle day is changed). Returns false when the
// provider does not exist.
export function resetImageProviderCalls(slug: string, cycleStart: string | null): boolean {
  const updated = db.run(
    `UPDATE image_providers
     SET calls_this_cycle = 0, cycle_start = ?, updated_at = datetime('now')
     WHERE slug = ?`,
    [cycleStart, slug]
  );
  if (updated.changes === 0) return false;
  persist();
  return true;
}

// ── Provider feed images (global, super admin) ───────────────────────────────

export interface ProviderFeedImageRow {
  id: number;
  brand: string;
  reference: string | null;
  ean: string | null;
  image_url: string;
  created_at: string;
}

export function listProviderFeedImages(search = ''): ProviderFeedImageRow[] {
  const term = `%${search.trim()}%`;
  return queryAll(
    `SELECT id, brand, reference, ean, image_url, created_at
     FROM provider_feed_images
     WHERE brand LIKE ? OR reference LIKE ? OR ean LIKE ?
     ORDER BY brand, id`,
    [term, term, term]
  ) as unknown as ProviderFeedImageRow[];
}

export function addProviderFeedImage(row: {
  brand: string;
  reference?: string | null;
  ean?: string | null;
  image_url: string;
}): ProviderFeedImageRow {
  db.run(
    `INSERT INTO provider_feed_images (brand, reference, ean, image_url)
     VALUES (?, ?, ?, ?)`,
    [row.brand.trim(), (row.reference ?? '').trim() || null, (row.ean ?? '').trim() || null, row.image_url.trim()]
  );
  // The rowid must be read before exporting/persisting; db.export() resets the
  // connection's last_insert_rowid (mirrors createComercio).
  const id = queryOne('SELECT last_insert_rowid() as id')?.id as number;
  persist();
  const created = queryOne(
    'SELECT id, brand, reference, ean, image_url, created_at FROM provider_feed_images WHERE id = ?',
    [id]
  );
  return created as ProviderFeedImageRow;
}

export function deleteProviderFeedImage(id: number): boolean {
  const result = db.run('DELETE FROM provider_feed_images WHERE id = ?', [id]);
  if (result.changes === 0) return false;
  persist();
  return true;
}

// Looks up feed images for a product with decreasing specificity: exact
// brand+reference+ean, then brand+reference, then brand+ean. A product may
// legitimately have several images for the same triple, so every match is
// returned. Empty product keys are skipped so a missing EAN never forces all
// rows to match.
export function lookupProviderFeedImages(brand: string, reference: string, ean: string): string[] {
  const b = brand.trim();
  const r = reference.trim();
  const e = ean.trim();

  const exact =
    b && r && e
      ? queryAll(
          'SELECT image_url FROM provider_feed_images WHERE brand = ? AND reference = ? AND ean = ?',
          [b, r, e]
        )
      : [];
  if (exact.length > 0) return exact.map((row) => row.image_url as string);

  const byRef =
    b && r
      ? queryAll('SELECT image_url FROM provider_feed_images WHERE brand = ? AND reference = ?', [b, r])
      : [];
  if (byRef.length > 0) return byRef.map((row) => row.image_url as string);

  const byEan =
    b && e
      ? queryAll('SELECT image_url FROM provider_feed_images WHERE brand = ? AND ean = ?', [b, e])
      : [];
  return byEan.map((row) => row.image_url as string);
}
