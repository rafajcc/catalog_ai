# Database Layer

How catalog_ai decides where to store its data and how the external database
driver works. The goal is a production deployment that keeps SQLite as its
zero-config default and can point at a **managed MySQL / MariaDB** from the
environment — **without changing a single business SQL statement, function
signature, row shape or synchronous call**.

## Status

- Implemented. Backend boots on SQLite (`sql.js`) by default; `DB_TYPE=mysql|mariadb`
  (or a full `DATABASE_URL`/`DB_URL`) switches to MySQL/MariaDB. PostgreSQL is not
  implemented yet and fails at boot with a clear error.
- Both dialects are validated: the full backend Jest suite runs on SQLite, and an
  opt-in integration test (`MYSQL_TEST_URL`) runs the very same `initDatabase` +
  business cycle against a real MySQL/MariaDB server.

## Configuration (environment)

Read once at boot by `backend/src/db/index.ts` and **frozen for the process**:
the app never re-reads these variables nor switches dialect mid-run.

| Variable | Values (default first) | Purpose |
|---|---|---|
| `DB_TYPE` | `sqlite` \| `mysql` \| `mariadb` | Forces the dialect. Unset + no URL/`DB_*` ⇒ sqlite. `postgres`/unknown ⇒ boot error. |
| `DATABASE_URL` / `DB_URL` | `mysql://user:pass@host:port/db` | Complete external connection (aliases; URL must carry user, password and db name). |
| `DB_HOST` | string | External host (socket path). |
| `DB_PORT` | number (`3306`) | External port. Optional, defaults to 3306. |
| `DB_NAME` | string | Database name. |
| `DB_USER` | string | Login user. |
| `DB_PASSWORD` | string | Password. |
| `DB_SSL` | `false` \| `true` | TLS for the connection. |
| `DB_MAX_POOL` | number (`10`) | Connection-pool size of the worker. |
| `DATA_DIR` | path | Used only by sqlite: location of `catalogai.db`. |

Resolution rules (`resolveDbDialect`):

- `DB_TYPE=sqlite` always wins and ignores any residual external variable.
- A complete `DATABASE_URL`/`DB_URL` (`mysql://`/`mariadb://`) overrides the individual `DB_*`.
- `DB_HOST`+`DB_NAME`+`DB_USER`+`DB_PASSWORD` present ⇒ external MySQL/MariaDB.
- Any other combination (incomplete `DB_*`, unsupported dialect, `DB_TYPE=mysql`
  without connection data) throws a descriptive error at boot instead of silently
  running on the wrong backend.

## Design

### Why synchronous?

The whole domain layer (`backend/src/modules/auth/database.ts`, image providers,
config persistence) is synchronous today: `runDb`/`queryAll`/`queryOne`/`persist`
are called without `await` in hundreds of call sites. `sql.js` is in-memory
synchronous, but MySQL/MariaDB drivers (`mysql2`) are asynchronous.

To honor the "zero changes to business logic" constraint, the adapter exposes the
**same synchronous surface**: a single `worker_thread` owns the real `mysql2/promise`
connection, and the main thread talks to it through a `MessageChannel` port,
blocking on a `SharedArrayBuffer` + `Atomics.wait` until the answer arrives
(`backend/src/db/drivers/mysql.ts`). Every public function of `database.ts`
stays synchronous; nothing else in the app changed.

Key facts of the synchronous bridge:

- Requests are sent via the **MessagePort** (`port1` kept as `__syncPort`, with
  the worker receiving `port2` through `transferList`) — NOT via
  `worker.postMessage` (the default channel has no listener).
- The worker source is a plain-JS string evaluated with `eval: true`, so it must
  not contain any TypeScript syntax (a leftover `(err as any).code` broke it).
- One connection inside the worker preserves `LAST_INSERT_ID()` semantics (the
  same single-session behaviour `sql.js` has).
- `createMysqlClient` performs a synchronous `SELECT 1` at boot and throws if
  the server is unreachable; `QUERY_TIMEOUT_MS = 30000` bounds every call.

### SQL translation at the boundary

The domain SQL keeps SQLite syntax. `translateMysqlQuery` rewrites only these
patterns before execution (order matters — the date-window rule comes first):

| SQLite | MySQL |
|---|---|
| `INSERT OR IGNORE` | `INSERT IGNORE` |
| `INSERT ... ON CONFLICT(c) DO UPDATE SET col = excluded.col` | `INSERT ... ON DUPLICATE KEY UPDATE col = VALUES(col)` |
| `datetime('now')` | `CURRENT_TIMESTAMP` |
| `datetime('now','-' \|\| ? \|\| ' minutes')` | `DATE_SUB(NOW(), INTERVAL ? MINUTE)` |
| `last_insert_rowid()` | `LAST_INSERT_ID()` |
| `PRAGMA table_info(t)` | `information_schema.columns` (aliased `name`) |
| neutral SQL (`SELECT`/`INSERT`/`UPDATE`/`DELETE`) | unchanged |

`applySchema` applies the translated DDL idempotently (`CREATE TABLE IF NOT EXISTS`,
`CREATE INDEX IF NOT EXISTS` guarded via `information_schema.statistics`) and then the
same seed rows the sqlite path uses (`INSERT IGNORE …`), keeping `schema_version`
consistent across dialects.

### Type mapping

- `DATE`/`DATETIME`/`TIMESTAMP` come back as strings (`YYYY-MM-DD HH:MM:SS`)
  matching the sqlite format via a custom `typeCast`.
- `TINYINT` stays a number (`0`/`1`), so boolean columns serialize the same as sqlite.
- Connection flags: `FOUND_ROWS` (real `affectedRows`), `charset: utf8mb4`,
  `timezone: 'Z'`, `connectTimeout: 10000`.

### Where the switch happens

`backend/src/modules/auth/database.ts` keeps every public function and signature;
internally it routes each low-level helper by `activeDialect`:

- sqlite → the existing `sql.js` code, byte-for-byte (file at `DATA_DIR/catalogai.db`,
  whole-DB export on `persist()`).
- mysql → `initMysqlDatabase` (from `db/index.ts` externally-resolved config) +
  the worker client. `persist()` is a **no-op** (the server persists itself);
  `getDatabase()` throws when there is no sql.js handle.

## Bootstrap flow

```ts
// backend/src/modules/auth/database.ts (concept)
const { dialect, external, rootDir } = getPersistenceConfig(); // once, frozen
initDatabase(rootDir, external); // sqlite as before | mysql via worker client
```

`initDatabase` remains `async` (as it already was); all other functions stay
synchronous.

## Testing

- Default suite runs on SQLite (`DATA_DIR` temp dir) — zero test changes.
- `backend/src/db/drivers/mysql.test.ts`:
  - `translateMysqlQuery` covers every translation pattern.
  - `createMysqlClient` propagates a connection-refused error synchronously (no 30 s timeout).
  - **Opt-in integration** (`describe.skip` unless `MYSQL_TEST_URL` is set): the full
    `initDatabase` + business cycle (`createComercio`, `createUser`, config upserts,
    `listMarketplaces`, auth-nonce/login-attempt helpers, `deleteComercio` cascade)
    against a real server, including the provider seeds (`seedImageProviders`).

## Deployment notes

- Production keeps working with just `DATA_DIR` pointing at a mounted volume.
- For a managed MySQL/MariaDB: set a complete `DATABASE_URL` (or `DB_*`) and the
  app creates/synchronizes the schema on boot. `persist()` is a no-op; nothing else
  changes.
- PostgreSQL is deliberately rejected at boot (clear error) instead of half-working.

## Risks / open questions

- **Blocking main thread**: each call parks the main thread for up to 30 s while the
  worker answers. The domain code was already synchronous, so this is the same
  behaviour the user sees today with sql.js, only with a real round-trip.
- **Single connection map**: one worker ⇒ one connection. Concurrent instances share
  the database and rely on the server's own locking; per-instance `LAST_INSERT_ID`
  stays correct because only that instance's worker connection writes within each
  session.
- **Schema drift**: like sqlite, there are no migrations — idempotent DDL with a
  `schema_version` marker. Adding a column later must follow the curated-CREATE
  pattern already used for sqlite.