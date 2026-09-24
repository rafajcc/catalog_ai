# Capa de base de datos

Cómo decide catalog_ai dónde almacenar sus datos y cómo funciona el driver de base de datos
externa. El objetivo es un despliegue de producción que conserve SQLite como opción por defecto
de cero configuración y pueda apuntar a un **MySQL / MariaDB gestionado** desde el entorno —
**sin cambiar una sola sentencia SQL de negocio, firma de función, forma de fila o llamada
síncrona**.

## Estado

- Implementado. El backend arranca con SQLite (`sql.js`) por defecto; `DB_TYPE=mysql|mariadb`
  (o un `DATABASE_URL`/`DB_URL` completo) cambia a MySQL/MariaDB. PostgreSQL no está implementado
  todavía y falla al arrancar con un error claro.
- Ambos dialectos están validados: la suite Jest completa del backend corre sobre SQLite, y un
  test de integración opt-in (`MYSQL_TEST_URL`) ejecuta el mismo `initDatabase` + ciclo de negocio
  contra un MySQL/MariaDB real.

## Configuración (entorno)

Se lee una sola vez al arrancar en `backend/src/db/index.ts` y queda **congelada para el proceso**:
la app nunca vuelve a leer estas variables ni cambia de dialecto a mitad de ejecución.

| Variable | Valores (predeterminado primero) | Propósito |
|---|---|---|
| `DB_TYPE` | `sqlite` \| `mysql` \| `mariadb` | Fuerza el dialecto. Sin valor + sin URL/`DB_*` ⇒ sqlite. `postgres`/desconocido ⇒ error de arranque. |
| `DATABASE_URL` / `DB_URL` | `mysql://usuario:contrasena@host:puerto/bd` | Conexión externa completa (alias; la URL debe llevar usuario, contraseña y nombre de BD). |
| `DB_HOST` | string | Host externo (socket path). |
| `DB_PORT` | número (`3306`) | Puerto externo. Opcional, por defecto 3306. |
| `DB_NAME` | string | Nombre de la base de datos. |
| `DB_USER` | string | Usuario de conexión. |
| `DB_PASSWORD` | string | Contraseña. |
| `DB_SSL` | `false` \| `true` | TLS para la conexión. |
| `DB_MAX_POOL` | número (`10`) | Tamaño del pool de conexiones del worker. |
| `DATA_DIR` | ruta | Solo lo usa sqlite: ubicación de `catalogai.db`. |

Reglas de resolución (`resolveDbDialect`):

- `DB_TYPE=sqlite` siempre gana e ignora cualquier variable externa residual.
- Un `DATABASE_URL`/`DB_URL` completo (`mysql://`/`mariadb://`) tiene prioridad sobre el grupo `DB_*`.
- `DB_HOST`+`DB_NAME`+`DB_USER`+`DB_PASSWORD` presentes ⇒ MySQL/MariaDB externo.
- Cualquier otra combinación (`DB_*` incompleto, dialecto no soportado, `DB_TYPE=mysql` sin datos
  de conexión) lanza un error descriptivo al arrancar en lugar de correr silenciosamente sobre el
  backend equivocado.

## Diseño

### ¿Por qué síncrono?

Toda la capa de dominio (`backend/src/modules/auth/database.ts`, proveedores de imágenes,
persistencia de configuración) es síncrona hoy: `runDb`/`queryAll`/`queryOne`/`persist` se
llaman sin `await` en cientos de puntos. `sql.js` es síncrono en memoria, pero los drivers de
MySQL/MariaDB (`mysql2`) son asíncronos.

Para honrar la restricción de "cero cambios en lógica de negocio", el adaptador expone la
misma superficie **síncrona**: un único `worker_thread` posee la conexión real `mysql2/promise`,
y el hilo principal le habla mediante un puerto `MessageChannel`, bloqueándose sobre un
`SharedArrayBuffer` + `Atomics.wait` hasta que llega la respuesta (`backend/src/db/drivers/mysql.ts`).
Toda función pública de `database.ts` sigue siendo síncrona; nada más cambió en la app.

Hechos clave del puente síncrono:

- Las peticiones viajan por el **MessagePort** (`port1` guardado como `__syncPort`, con el worker
  recibiendo `port2` mediante `transferList`) — NO por `worker.postMessage` (el canal por defecto
  no tiene listener).
- El código del worker es un string de JS plano evaluado con `eval: true`, así que no debe
  contener sintaxis TypeScript (un `(err as any).code` residual lo rompía).
- Una sola conexión dentro del worker preserva la semántica de `LAST_INSERT_ID()` (el mismo
  comportamiento de sesión única que `sql.js`).
- `createMysqlClient` ejecuta un `SELECT 1` síncrono al arrancar y lanza si el servidor no es
  alcanzable; `QUERY_TIMEOUT_MS = 30000` acota cada llamada.

### Traducción de SQL en el límite

El SQL de dominio mantiene la sintaxis sqlite. `translateMysqlQuery` reescribe solo estos
patrones antes de ejecutar (el orden importa — la regla de ventana de fechas va antes):

| SQLite | MySQL |
|---|---|
| `INSERT OR IGNORE` | `INSERT IGNORE` |
| `INSERT ... ON CONFLICT(c) DO UPDATE SET col = excluded.col` | `INSERT ... ON DUPLICATE KEY UPDATE col = VALUES(col)` |
| `datetime('now')` | `CURRENT_TIMESTAMP` |
| `datetime('now','-' \|\| ? \|\| ' minutes')` | `DATE_SUB(NOW(), INTERVAL ? MINUTE)` |
| `last_insert_rowid()` | `LAST_INSERT_ID()` |
| `PRAGMA table_info(t)` | `information_schema.columns` (con alias `name`) |
| SQL neutro (`SELECT`/`INSERT`/`UPDATE`/`DELETE`) | sin cambios |

`applySchema` aplica el DDL traducido de forma idempotente (`CREATE TABLE IF NOT EXISTS`,
`CREATE INDEX IF NOT EXISTS` con guarda vía `information_schema.statistics`) y después las mismas
filas de siembra que usa la ruta sqlite (`INSERT IGNORE …`), manteniendo `schema_version`
coherente entre dialectos.

### Mapeo de tipos

- `DATE`/`DATETIME`/`TIMESTAMP` vuelven como cadenas (`YYYY-MM-DD HH:MM:SS`) en el mismo formato
  sqlite mediante un `typeCast` propio.
- `TINYINT` sigue siendo número (`0`/`1`), de modo que las columnas booleanas se serializan igual
  que en sqlite.
- Flags de conexión: `FOUND_ROWS` (afecta filas reales), `charset: utf8mb4`, `timezone: 'Z'`,
  `connectTimeout: 10000`.

### Dónde ocurre el cambio

`backend/src/modules/auth/database.ts` conserva cada función pública y su firma; internamente
enruta los helpers de bajo nivel por `activeDialect`:

- sqlite → el código `sql.js` existente, byte a byte (archivo en `DATA_DIR/catalogai.db`, exportación
  completa de la BD en `persist()`).
- mysql → `initMysqlDatabase` (desde la config externa resuelta en `db/index.ts`) + el cliente
  worker. `persist()` es un **no-op** (el servidor se persiste a sí mismo); `getDatabase()` lanza
  cuando no hay un handle de sql.js.

## Flujo de arranque

```ts
// backend/src/modules/auth/database.ts (concepto)
const { dialect, external, rootDir } = getPersistenceConfig(); // una vez, congelado
initDatabase(rootDir, external); // sqlite como antes | mysql vía cliente worker
```

`initDatabase` sigue siendo `async` (ya lo era); el resto de funciones permanecen síncronas.

## Pruebas

- La suite por defecto corre sobre SQLite (directorio temporal `DATA_DIR`) — cero cambios en tests.
- `backend/src/db/drivers/mysql.test.ts`:
  - `translateMysqlQuery` cubre todos los patrones de traducción.
  - `createMysqlClient` propaga un error de conexión rechazada de forma síncrona (sin timeout de 30 s).
  - **Integración opt-in** (`describe.skip` a menos que esté `MYSQL_TEST_URL`): el ciclo completo de
    `initDatabase` + negocio (`createComercio`, `createUser`, upsert de config,
    `listMarketplaces`, helpers de auth nonce/intento de login, cascada de `deleteComercio`)
    contra un servidor real, incluida la siembra de proveedores (`seedImageProviders`).

## Notas de despliegue

- Producción sigue funcionando solo con `DATA_DIR` apuntando a un volumen montado.
- Para MySQL/MariaDB gestionado: define un `DATABASE_URL` completo (o `DB_*`) y la app crea y
  sincroniza el esquema al arrancar. `persist()` es no-op; nada más cambia.
- PostgreSQL se rechaza deliberadamente al arrancar (error claro) en lugar de funcionar a medias.

## Riesgos / preguntas abiertas

- **Bloqueo del hilo principal**: cada llamada bloquea el hilo principal hasta 30 s mientras el
  worker responde. El código de dominio ya era síncrono, así que es el mismo comportamiento que
  el usuario ve hoy con sql.js, solo que con un round-trip real.
- **Mapa de una sola conexión**: un worker ⇒ una conexión. Instancias concurrentes comparten la
  base de datos y dependen del bloqueo del propio servidor; el `LAST_INSERT_ID()` por instancia
  sigue siendo correcto porque solo la conexión worker de esa instancia escribe dentro de cada sesión.
- **Deriva de esquema**: igual que sqlite, no hay migraciones — DDL idempotente con un marcador
  `schema_version`. Añadir una columna más adelante debe seguir el patrón de CREATE curado que ya
  se usa para sqlite.