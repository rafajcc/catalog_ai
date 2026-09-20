# Diseño de la capa de base de datos

Diseño técnico para hacer que la capa de persistencia sea intercambiable entre la base de
datos SQLite embebida (`sql.js`) y una base de datos relacional externa (PostgreSQL / MySQL)
seleccionada desde el entorno. Este documento es una **propuesta de diseño** — describe la
arquitectura objetivo; los cambios de código quedan fuera del alcance de este documento.

## Estado

- Implementación actual: SQLite embebida vía `sql.js` (`backend/src/modules/auth/database.ts`), API síncrona, exportación completa de la base de datos a disco en cada escritura (`persist()`).
- Objetivo: una interfaz `DatabaseAdapter` (puerto) con dos adaptadores — `SqliteAdapter` (comportamiento actual, con superficie asíncrona) y `PgAdapter` / `MysqlAdapter` (servidor externo). El resto de la app habla solo con la interfaz.

## Motivación

1. **Durabilidad**: SQLite es un único archivo local; en filesystems efímeros (Railway, contenedores sin volúmenes montados) los datos se pierden al redeployear salvo que `DATA_DIR` apunte a un volumen.
2. **Concurrencia**: SQLite serializa las escrituras; varias instancias del backend o tráfico alto convierten el archivo en el cuello de botella.
3. **PostgreSQL / MySQL gestionado** alojado en otro sitio separa el almacenamiento del cómputo y permite que varias instancias de la app compartan un mismo dataset.

## No objetivos

- No es un ORM. El SQL de dominio vive en los adaptadores / `database.ts` y sigue siendo explícito.
- No es una herramienta de migraciones (nada de `knex` / `prisma`). El esquema sigue siendo idempotente vía `CREATE TABLE IF NOT EXISTS` aplicado al arrancar, como hoy.
- No cambia las formas de las filas de la capa de dominio, los contratos de los endpoints ni el modelo multiinquilino.

## Configuración (entorno)

Se lee al arrancar en la nueva fábrica; los valores vienen del mismo mecanismo `.env` que el resto de la app (sin auto-carga de dotenv, igual que hoy).

| Variable | Valores (predeterminado primero) | Propósito |
|---|---|---|
| `DB_TYPE` | `sqlite` \| `postgres` \| `mysql` | Selecciona el adaptador. `sqlite` como predeterminado conserva el comportamiento actual. |
| `DB_HOST` | string (`localhost`) | Adaptador: host remoto / socket path (postgres/mysql). Ignorada para sqlite. |
| `DB_PORT` | número (postgres `5432`, mysql `3306`) | Adaptador: puerto remoto. Ignorada para sqlite. |
| `DB_NAME` | string | Adaptador: nombre de la base de datos. Ignorada para sqlite (sqlite usa `DATA_DIR/catalogai.db`). |
| `DB_USER` | string | Adaptador: usuario de login. |
| `DB_PASSWORD` | string | Adaptador: contraseña. |
| `DB_SSL` | `false` \| `true` | Adaptador: TLS para la conexión (postgres/mysql). |
| `DB_MAX_POOL` | número (`10`) | Adaptador: tamaño del pool de conexiones. |
| `DATA_DIR` | ruta | Sigue usándola el adaptador `sqlite` para ubicar `catalogai.db`. Ignorada para los adaptadores remotos. |

`DB_TYPE=sqlite` (o sin configurar) debe ser byte a byte equivalente al comportamiento actual:
mismo archivo, mismo esquema, misma cadencia de `persist()`.

## Diseño

### Puerto: `DatabaseAdapter`

Todo lo que hay debajo de `database.ts` interroga la base de datos a través de una interfaz
pequeña. La implementación se elige una vez al arrancar y se mantiene como singleton,
exactamente como las variables modulares `db` / `dbPath` actuales — el resto de módulos siguen
llamando a las mismas funciones públicas de `database.ts`.

```ts
// backend/src/modules/auth/database-adapter.ts (nuevo)

export type SqlParam = string | number | null | boolean;

export interface RunResult {
  changes: number;
  lastInsertRowid: number | undefined;  // de RETURNING / last_insert_rowid()
}

export interface DatabaseAdapter {
  readonly dialect: 'sqlite' | 'postgres' | 'mysql';
  init(): Promise<void>;
  run(sql: string, params?: SqlParam[]): Promise<RunResult>;
  queryAll(sql: string, params?: SqlParam[]): Promise<Record<string, unknown>[]>;
  queryOne(sql: string, params?: SqlParam[]): Promise<Record<string, unknown> | undefined>;
  exec(sql: string): Promise<void>;            // multi-statement (esquema)
  persist(): Promise<void>;                    // no-op para adaptadores remotos
  close(): Promise<void>;
}
```

Decisiones de diseño:

- **Async en todas partes.** `sql.js` es síncrono; `pg` / `mysql2` son asíncronos. Para tener un
  único puerto, cada método devuelve `Promise`. El `SqliteAdapter` envuelve su trabajo síncrono
  en un método `async` (barato: las llamadas de sql.js son en memoria) de modo que el resto de
  la app solo hace `await`.
- **`persist()` es parte del puerto** pero se convierte en **no-op** en los adaptadores remotos
  (el servidor se persiste solo). `database.ts` sigue llamándolo después de cada escritura — sin
  cambios en el código de módulo.
- **Placeholders**. Se mantiene el estilo actual de placeholders `?`. PostgreSQL usa `$1`/`$2`…,
  así que el `PgAdapter` reescribe `?` → `$n` (un pequeño helper) antes de llamar al driver;
  MySQL ya usa `?`. Esto mantiene todo el SQL de dominio intacto.
- **Diferencias de dialecto en SQL**. Sintaxis solo de SQLite que hoy usa `database.ts`:
  - `INSERT OR IGNORE` → traducido por el adaptador:
    - postgres `INSERT ... ON CONFLICT DO NOTHING`,
    - mysql `INSERT IGNORE`.
  - `ON CONFLICT(key) DO UPDATE SET col = excluded.col` → postgres usa lo mismo; mysql usa
    `INSERT ... ON DUPLICATE KEY UPDATE col = VALUES(col)`. Los adaptadores proveen un pequeño
    helper `upsert(table, conflictKeys, data)` para que `database.ts` no cambie.
  - `datetime('now')` → postgres `CURRENT_TIMESTAMP`, mysql `CURRENT_TIMESTAMP`. Ambos
    funcionan; el adaptador normaliza el literal.
  - `last_insert_rowid()` → sqlite lo mantiene; postgres usa `RETURNING id`; mysql usa
    `LAST_INSERT_ID()`. El `RunResult.lastInsertRowid` lo oculta.
  - `PRAGMA table_info(table)` → sustituido por `hasColumn(table, column)` en el puerto,
    implementado por dialecto (`information_schema.columns` en postgres/mysql).
- **Booleanos**. SQLite almacena enteros `0`/`1`. `BOOLEAN` en Postgres/MySQL difiere; el
  adaptador convierte `1`/`0` ↔ `true`/`false` en el límite y el código de dominio nunca lo ve.

### Adaptador 1: `SqliteAdapter`

```ts
// backend/src/modules/auth/sqlite-adapter.ts (nuevo)
// Mueve el código sql.js existente tal cual al adaptador; comportamiento idéntico.
export class SqliteAdapter implements DatabaseAdapter {
  constructor(private readonly dataDir: string) {}
  async init(): Promise<void>     { /* cuerpo actual de initDatabase() */ }
  async run(...)                  { /* actual db.run + persist() en escritura */ }
  async queryAll / queryOne(...)  { /* helpers actuales db.prepare().step() */ }
  async exec(...)                 { /* actual db.exec(schema) */ }
  async persist()                 { /* persist() actual: exportar archivo */ }
  async close()                   { /* db.close() */ }
}
```

Es una extracción pura sin cambios de comportamiento: ruta desde `DATA_DIR`, `catalogai.db`,
el string `SCHEMA` con `SCHEMA_VERSION = 6`, filas de siembra y migraciones se mueven tal cual.

### Adaptador 2: `PgAdapter` (PostgreSQL)

```ts
// backend/src/modules/auth/pg-adapter.ts (nuevo)
// Depende de `pg` (Pool). Nueva dependencia en el backend.
export class PgAdapter implements DatabaseAdapter {
  constructor(private readonly opts: PgOptions) {}
  async init(): Promise<void> {
    this.pool = new Pool({ /* host, port, db, user, password, ssl, max */ });
    await this.exec(SQLITE_PG_SCHEMA);            // mismas tablas, tipos PG
    await this.seedGlobalRows();                  // INSERT ... ON CONFLICT DO NOTHING
  }
  async run(sql, params)  { /* reescribir ? → $n; RETURNING para el último id */ }
  async queryAll(sql, params) { /* reescribir ? → $n */ }
  async persist() { /* no-op */ }
}
```

El esquema de Postgres es el mismo conjunto de tablas, con DDL traducido:

| Columna SQLite | Postgres |
|---|---|
| `INTEGER PRIMARY KEY AUTOINCREMENT` | `SERIAL PRIMARY KEY` |
| `TEXT` | `TEXT` |
| `INTEGER` (booleanos/contadores) | `INTEGER` (se mantiene entero para formas de fila idénticas) |
| `DEFAULT (datetime('now'))` | `DEFAULT CURRENT_TIMESTAMP` |
| `CREATE INDEX` | `CREATE INDEX` (igual) |

Las claves foráneas, las restricciones únicas y las PK compuestas (`comercio_marketplaces`,
`comercio_ai_providers`) mapean 1:1.

### Adaptador 3: `MysqlAdapter` (MySQL 8+)

Espejo del `PgAdapter` con `mysql2/promise`; `INSERT IGNORE` / `ON DUPLICATE KEY UPDATE`,
`LAST_INSERT_ID()`, placeholders `?` ya coinciden. Misma DDL traducida
(`AUTO_INCREMENT`, `DATETIME DEFAULT CURRENT_TIMESTAMP`).

## Migración del módulo de dominio

`backend/src/modules/auth/database.ts` mantiene los nombres y firmas públicas de sus funciones
salvo que **todas se vuelven async**:

```ts
export async function createComercio(name: string): Promise<ComercioRow> { ... }
export async function findUserByUsername(username, comercioId): Promise<UserRow | undefined> { ... }
// ... una a una: run/queryAll/queryOne + persist() pasan a ser promesas en await
```

Llamadores que cambian (añadir `await` / `.then`):

- `backend/src/app.ts` — `await initDatabase(...)` (ya es async).
- `backend/src/modules/database-persistence/database-persistence.ts` — `load()` / `save()` se vuelven async; el middleware `loadComercioConfig` se adapta.
- `backend/src/modules/auth/routes.ts`, `middleware.ts`, `load-config-middleware.ts`, `super-admin.ts`.
- `backend/src/modules/image-providers/registry.ts`, `router.ts`, `services/engine.ts`, `providers/feeds.ts`.
- Tests que importan `../auth/database` (`database-persistence.test.ts`, tests de rutas, etc.).

Como la interfaz es solo-async, volver async cada función de dominio es mecánico: await sin
sleeps; la compilación tipea el rizado automáticamente. Conviene hacer el cambio en un único
commit mecánico para que el comportamiento siga siendo idéntico antes de añadir ningún adaptador.

## Flujo de arranque (futuro)

```ts
// backend/src/modules/auth/database.ts (arriba)
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

Los llamadores de `app.ts` siguen pasando `dataDir`; el entorno se lee dentro para mantener la
firma pública.

## Plan de rodaje

1. **Extracción (sin cambio de comportamiento).** Volcar el código sql.js al `SqliteAdapter`;
   `database.ts` delega en el puerto; todas las funciones se vuelven `async`; cada llamador hace
   `await`. Tests verdes (suite jest completa), comportamiento runtime idéntico.
2. **Adaptador Postgres.** Añadir dependencia `pg`, traducción de DDL, reescritura `?`→`$n`,
   helper de upsert. Añadir un job CI opcional que arranque la suite contra PostgreSQL.
3. **Adaptador MySQL** (mismo patrón), si se requiere.
4. **Docs + `.env.example`** — este diseño, las variables `DB_*`, notas de despliegue.

## Pruebas

- Por defecto: los tests siguen corriendo contra `SqliteAdapter` con `DATA_DIR` apuntando a un
  directorio temporal (o `:memory:`) — cero cambios en los tests existentes.
- Los adaptadores reciben un **test de contrato compartido** (`database-adapter.test.ts`) que
  ejecuta las mismas aserciones contra cada adaptador (sqlite siempre; postgres/mysql detrás de
  `DB_TYPE` cuando el entorno provee una conexión).
- Los tests de motor/rutas ya stubean HTTP; solo necesitan añadir `await`, no nuevos mocks.

## Riesgos / preguntas abiertas

- **Escrituras síncronas en el camino caliente** (cada `persist()` exporta toda la BD). Para
  sqlite se mantiene tal cual; Postgres lo sustituye por autocommit normal, sin coste equivalente.
- **Traducción del set-clause de `ON CONFLICT`** es la pieza más específica de SQLite;
  confinarla al helper del adaptador evita filtrar dialecto al código de dominio.
- **Zona horaria**: `datetime('now')` es UTC en SQLite; `CURRENT_TIMESTAMP` en Postgres/MySQL
  también es UTC — los defaults de DDL siguen siendo consistentes.
- **`RETURNING id` vs `last_insert_rowid()`** orden: la precaución del `SELECT last_insert_rowid()`
  por el reset de `db.export()` desaparece bajo `RETURNING` de Postgres; ambos caminos quedan
  cubiertos por `RunResult.lastInsertRowid`.