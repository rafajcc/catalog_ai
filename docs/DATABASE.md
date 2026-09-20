# Database Layer Design

Technical design for making the persistence layer pluggable between the embedded SQLite
database (`sql.js`) and an external relational database (PostgreSQL / MySQL) selected from
the environment. This document is a **design proposal** — it describes the target
architecture; the code changes themselves are out of scope for this document.

## Status

- Current implementation: SQLite embedded via `sql.js` (`backend/src/modules/auth/database.ts`), synchronous API, whole-database export to disk on every write (`persist()`).
- Target: a `DatabaseAdapter` interface (port) with two adapters — `SqliteAdapter` (existing behaviour, made async on the surface) and `PgAdapter` / `MysqlAdapter` (external server). The rest of the app talks only to the interface.

## Motivation

1. **Durability**: SQLite is a single local file; on ephemeral filesystems (Railway, containers with volumes not mounted) data is lost on redeploy unless `DATA_DIR` points to a volume.
2. **Concurrency**: SQLite serializes writes; several backend instances or high traffic make the file the bottleneck.
3. **Managed PostgreSQL / MySQL** hosted elsewhere separates storage from compute and allows multiple app instances to share one dataset.

## Non-goals

- Not an ORM. The domain SQL lives in the adapters / `database.ts` and stays explicit.
- Not schema-migration tooling (no `knex` / `prisma`). Schema is still idempotent `CREATE TABLE IF NOT EXISTS` applied at boot, as today.
- Not changing the domain-layer row shapes, endpoint contracts or multi-tenancy model.

## Configuration (environment)

Read at boot by the new factory; values come from the same `.env` mechanism as the rest of
the app (no dotenv auto-loading, same as today).

| Variable | Values (default first) | Purpose |
|---|---|---|
| `DB_TYPE` | `sqlite` \| `postgres` \| `mysql` | Selects the adapter. `sqlite` default preserves current behaviour. |
| `DB_HOST` | string (`localhost`) | Adapter: remote host / Socket path (postgres/mysql). Ignored for sqlite. |
| `DB_PORT` | number (postgres `5432`, mysql `3306`) | Adapter: remote port. Ignored for sqlite. |
| `DB_NAME` | string | Adapter: database name. Ignored for sqlite (sqlite uses `DATA_DIR/catalogai.db`). |
| `DB_USER` | string | Adapter: login user. |
| `DB_PASSWORD` | string | Adapter: password. |
| `DB_SSL` | `false` \| `true` | Adapter: TLS for the connection (postgres/mysql). |
| `DB_MAX_POOL` | number (`10`) | Adapter: connection-pool size. |
| `DATA_DIR` | path | Still used by `sqlite` adapter to locate `catalogai.db`. Ignored for remote adapters. |

`DB_TYPE=sqlite` (or unset) must be byte-for-byte equivalent to the current behaviour:
same file, same schema, same `persist()` cadence.

## Design

### Port: `DatabaseAdapter`

Everything below `database.ts` interrogates the database through a small interface. The
implementation is chosen once at boot and kept as a singleton, exactly like the current
module-level `db` / `dbPath` variables — the rest of the modules keep calling the same
`database.ts` public functions.

```ts
// backend/src/modules/auth/database-adapter.ts (new)

export type SqlParam = string | number | null | boolean;

export interface RunResult {
  changes: number;
  lastInsertRowid: number | undefined;  // from RETURNING / last_insert_rowid()
}

export interface DatabaseAdapter {
  readonly dialect: 'sqlite' | 'postgres' | 'mysql';
  init(): Promise<void>;
  run(sql: string, params?: SqlParam[]): Promise<RunResult>;
  queryAll(sql: string, params?: SqlParam[]): Promise<Record<string, unknown>[]>;
  queryOne(sql: string, params?: SqlParam[]): Promise<Record<string, unknown> | undefined>;
  exec(sql: string): Promise<void>;            // multi-statement (schema)
  persist(): Promise<void>;                    // no-op for remote adapters
  close(): Promise<void>;
}
```

Design decisions:

- **Async everywhere.** `sql.js` is synchronous; `pg` / `mysql2` are asynchronous. To keep a
  single port, every method returns `Promise`. The `SqliteAdapter` wraps its sync work in an
  `async` method (cheap: sql.js calls are in-memory) so the rest of the app only ever awaits.
- **`persist()` is part of the port** but becomes a **no-op** on remote adapters (the server
  persists itself). `database.ts` keeps calling it after every write — no change in module code.
- **Placeholders**. Keep the existing `?` placeholder style in `database.ts`. PostgreSQL uses
  `$1`/`$2`…, so the `PgAdapter` rewrites `?` → `$n` (a small helper) before calling the driver;
  MySQL already uses `?` (or `pg` can accept `?` via `pg-format`-like rewrite). This keeps all
  domain SQL untouched.
- **Dialect differences in SQL**. SQLite-only syntax currently used in `database.ts`:
  - `INSERT OR IGNORE` → translated by the adapter:
    - postgres `INSERT ... ON CONFLICT DO NOTHING`,
    - mysql `INSERT IGNORE`.
  - `ON CONFLICT(key) DO UPDATE SET col = excluded.col` → postgres uses the same; mysql uses
    `INSERT ... ON DUPLICATE KEY UPDATE col = VALUES(col)`. Adapters provide a small
    `upsert(table, conflictKeys, data)` helper so `database.ts` does not change.
  - `datetime('now')` → postgres `CURRENT_TIMESTAMP`, mysql `CURRENT_TIMESTAMP`. Both work; the
    adapter normalizes the literal.
  - `last_insert_rowid()` → sqlite keeps it; postgres uses `RETURNING id`; mysql uses
    `LAST_INSERT_ID()`. The `RunResult.lastInsertRowid` hides this.
  - `PRAGMA table_info(table)` → replaced by `hasColumn(table, column)` on the port, implemented
    per dialect (`information_schema.columns` on postgres/mysql).
- **Booleans**. SQLite stores `0`/`1` integers. Postgres/MySQL `BOOLEAN` differs; the adapter
  converts `1`/`0` ↔ `true`/`false` at the boundary and the domain code never sees it.

### Adapter 1: `SqliteAdapter`

```ts
// backend/src/modules/auth/sqlite-adapter.ts (new)
// Moves the existing sql.js code verbatim into the adapter; identical behaviour.
export class SqliteAdapter implements DatabaseAdapter {
  constructor(private readonly dataDir: string) {}
  async init(): Promise<void>     { /* current initDatabase() body */ }
  async run(...)                  { /* current db.run + persist() on write */ }
  async queryAll / queryOne(...)  { /* current db.prepare().step() helpers */ }
  async exec(...)                 { /* current db.exec(schema) */ }
  async persist()                 { /* current persist(): export file */ }
  async close()                   { /* db.close() */ }
}
```

This is a pure extraction with zero behavioural change: path from `DATA_DIR`,
`catalogai.db`, the `SCHEMA` string with `SCHEMA_VERSION = 6`, seed rows and migrations all move
as-is.

### Adapter 2: `PgAdapter` (PostgreSQL)

```ts
// backend/src/modules/auth/pg-adapter.ts (new)
// Depends on `pg` (Pool). New dependency on the backend.
export class PgAdapter implements DatabaseAdapter {
  constructor(private readonly opts: PgOptions) {}
  async init(): Promise<void> {
    this.pool = new Pool({ /* host, port, db, user, password, ssl, max */ });
    await this.exec(SQLITE_PG_SCHEMA);            // same tables, PG types
    await this.seedGlobalRows();                  // INSERT ... ON CONFLICT DO NOTHING
  }
  async run(sql, params)  { /* rewrite ? → $n; RETURNING for last id */ }
  async queryAll(sql, params) { /* rewrite ? → $n */ }
  async persist() { /* no-op */ }
}
```

The Postgres schema is the same set of tables, translated DDL:

| SQLite column | Postgres |
|---|---|
| `INTEGER PRIMARY KEY AUTOINCREMENT` | `SERIAL PRIMARY KEY` |
| `TEXT` | `TEXT` |
| `INTEGER` (booleans/counters) | `INTEGER` (kept as integer for byte-identical row shapes) |
| `DEFAULT (datetime('now'))` | `DEFAULT CURRENT_TIMESTAMP` |
| `CREATE INDEX` | `CREATE INDEX` (same) |

Foreign keys, unique constraints and the composite PKs (`comercio_marketplaces`,
`comercio_ai_providers`) map 1:1.

### Adapter 3: `MysqlAdapter` (MySQL 8+)

Mirrors `PgAdapter` with `mysql2/promise`; `INSERT IGNORE` / `ON DUPLICATE KEY UPDATE`,
`LAST_INSERT_ID()`, `?` placeholders already match. Same translated DDL
(`AUTO_INCREMENT`, `DATETIME DEFAULT CURRENT_TIMESTAMP`).

## Migration of the domain module

`backend/src/modules/auth/database.ts` keeps its public function names and signatures except
that **every function becomes async**:

```ts
export async function createComercio(name: string): Promise<ComercioRow> { ... }
export async function findUserByUsername(username, comercioId): Promise<UserRow | undefined> { ... }
// ... one by one: run/queryAll/queryOne + persist() are now awaited promises
```

Callers that change (add `await` / `.then`):

- `backend/src/app.ts` — `await initDatabase(...)` (already async).
- `backend/src/modules/database-persistence/database-persistence.ts` — `load()` / `save()` become async; `loadComercioConfig` middleware adapts.
- `backend/src/modules/auth/routes.ts`, `middleware.ts`, `load-config-middleware.ts`, `super-admin.ts`.
- `backend/src/modules/image-providers/registry.ts`, `router.ts`, `services/engine.ts`, `providers/feeds.ts`.
- Tests that import `../auth/database` (`database-persistence.test.ts`, route tests, etc.).

Because the interface is async-only, making every domain function `async` is mechanical:
`sleep`-free awaits; compilation type-checks the ripple automatically. Advisable to do the
flip in a single mechanical commit so behaviour stays identical before any adapter is added.

## Bootstrap flow (future)

```ts
// backend/src/modules/auth/database.ts (top)
const factory: Record<DbType, (opts: DbOptions) => DatabaseAdapter> = {
  sqlite:   (o) => new SqliteAdapter(o.dataDir),
  postgres: (o) => new PgAdapter(o as PgOptions),
  mysql:    (o) => new MysqlAdapter(o as MysqlOptions),
};

export async function initDatabase(dataDir: string, env: NodeJS.ProcessEnv = process.env) {
  const type = (env.DB_TYPE ?? 'sqlite') as DbType;
  adapter = factory[type](parseDbOptions(dataDir, env));
  await adapter.init();
  return adapter;
}
```

`app.ts` callers keep passing `dataDir`; the env is read inside to keep the public signature.

## Rollout plan

1. **Extraction (no behaviour change).** Pull the sql.js code into `SqliteAdapter`;
   `database.ts` delegates to the port; all functions become `async`; every caller awaits.
   Green tests (full jest suite), identical runtime behaviour.
2. **Postgres adapter.** Add `pg` dependency, DDL translation, `?`→`$n` rewrite, upsert helper.
   Add an optional CI job that boots the suite against PostgreSQL.
3. **MySQL adapter** (same pattern), if required.
4. **Docs + `.env.example`** — this design, the `DB_*` variables, deployment notes.

## Testing

- Default: tests keep running against `SqliteAdapter` with `DATA_DIR` pointed to a temp dir
  (or `:memory:`) — zero change to existing tests.
- Adapters get a **shared contract test** (`database-adapter.test.ts`) that runs the same
  assertions against each adapter (sqlite always; postgres/mysql behind `DB_TYPE` when the
  env provides a connection).
- The engine/route tests already stub HTTP; they only need `await` added, not new mocks.

## Risks / open questions

- **Synchronous file writes on the hot path** (every `persist()` exports the whole DB). For
  sqlite the behaviour is kept as-is; Postgres replaces it with normal autocommit so there is
  no equivalent cost.
- **`ON CONFLICT` set-clause translation** is the most SQLite-specific piece; confining it to
  the adapter helper avoids leaking dialect into domain code.
- **Timezone**: `datetime('now')` is UTC in SQLite; `CURRENT_TIMESTAMP` in Postgres/MySQL is
  also UTC — DDL defaults remain consistent.
- **`RETURNING id` vs `last_insert_rowid()`** ordering: the `SELECT last_insert_rowid()`
  caveat about `db.export()` resetting it disappears under Postgres `RETURNING`; both paths are
  covered by `RunResult.lastInsertRowid`.