// Folder: backend/src/db
// Selector de persistencia: resuelve EN QUÉ dialecto corre la app (una vez, al
// arranque, y queda congelado hasta reiniciar).
//
//   - Ninguna variable de BD definida            → sqlite interno (DATA_DIR)
//   - DB_TYPE=sqlite                             → sqlite interno (fuerza)
//   - DATABASE_URL|DB_URL=mysql(s)://...         → MySQL/MariaDB externo
//   - DB_TYPE=mysql|mariadb y DB_* completos     → MySQL/MariaDB externo
//   - DB_HOST+DB_NAME+DB_USER+DB_PASSWORD        → MySQL/MariaDB externo (DB_PORT opcional, default 3306)
//   - Config externa incompleta                  → error claro en el arranque
//   - Dialecto no soportado (postgres, ...)      → error claro en el arranque
//
// El driver concreto (sql.js para sqlite, worker+mysql2 para mysql) vive en
// db/drivers; aquí solo se decide el destino.

export type DbDialect = 'sqlite' | 'mysql';

export interface ExternalDbConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl?: boolean;
  maxPool?: number;
}

/**
 * Resuelve el dialecto objetivo a partir del entorno. Lanza con un mensaje
 * claro cuando hay configuración externa incompleta o un dialecto no servible.
 */
export function resolveDbDialect(
  env: NodeJS.ProcessEnv = process.env
): { dialect: DbDialect; external?: ExternalDbConfig } {
  const type = env.DB_TYPE?.trim().toLowerCase();

  if (type === 'sqlite') {
    return { dialect: 'sqlite' };
  }

  if (type && type !== 'mysql' && type !== 'mariadb') {
    throw new Error(
      `DB_TYPE="${type}" no está soportado. Soportado: sqlite (default), mysql, mariadb. ` +
        `Sin DB_TYPE se decide por DATABASE_URL/DB_* o, en su defecto, sqlite interno.`
    );
  }

  const url = env.DATABASE_URL?.trim() || env.DB_URL?.trim();
  if (url) {
    if (url.startsWith('mysql://') || url.startsWith('mariadb://')) {
      return { dialect: 'mysql', external: parseMysqlUrl(url) };
    }
    // Cualquier otro proveedor explícito que no sepamos servir → error claro.
    throw new Error(
      `DATABASE_URL/DB_URL apunta a un dialecto no soportado todavía (${url.split(':')[0]}). ` +
        `Soportado: mysql:// o mariadb://. Sin DATABASE_URL/DB_* se usa sqlite interno.`
    );
  }

  const host = env.DB_HOST?.trim();
  const portRaw = env.DB_PORT?.trim();
  const database = env.DB_NAME?.trim();
  const user = env.DB_USER?.trim();
  if (host || database || user) {
    const missing: string[] = [];
    if (!host) missing.push('DB_HOST');
    if (!database) missing.push('DB_NAME');
    if (!user) missing.push('DB_USER');
    // DB_PASSWORD es obligatoria para conectarse; sin ella tampoco hay mysql.
    if (env.DB_PASSWORD === undefined) missing.push('DB_PASSWORD');
    if (missing.length > 0) {
      throw new Error(
        `Configuración externa incompleta. Faltan: ${missing.join(', ')}. ` +
          `Define DATABASE_URL completa o DB_HOST/DB_NAME/DB_USER/DB_PASSWORD ` +
          `(DB_PORT opcional, default 3306). Sin configuración externa se usa sqlite interno.`
      );
    }
    return {
      dialect: 'mysql',
      external: {
        host,
        port: portRaw ? Number(portRaw) : 3306,
        database,
        user,
        password: env.DB_PASSWORD!.trim(),
        ssl: env.DB_SSL?.trim() ? isTruthy(env.DB_SSL) : undefined,
        maxPool: env.DB_MAX_POOL?.trim() ? Number(env.DB_MAX_POOL) : undefined
      }
    };
  }

  if (type) {
    // DB_TYPE=mysql|mariadb sin URL ni DB_* → no hay forma de conectar.
    throw new Error(
      `DB_TYPE="${type}" requiere DATABASE_URL/DB_URL completa o ` +
        `DB_HOST/DB_NAME/DB_USER/DB_PASSWORD. Sin configuración externa se usa sqlite interno.`
    );
  }

  return { dialect: 'sqlite' };
}

function parseMysqlUrl(url: string): ExternalDbConfig {
  const parsed = new URL(url);
  const database = parsed.pathname.replace(/^\/+/, '') || '';
  if (!database) {
    throw new Error('DATABASE_URL mysql:// debe incluir nombre de base de datos en la ruta.');
  }
  if (!parsed.username || !parsed.password) {
    throw new Error('DATABASE_URL mysql:// debe incluir usuario y contraseña.');
  }
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 3306,
    database,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password)
  };
}

function isTruthy(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes((value ?? '').toLowerCase());
}

export function databaseConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env
): { dialect: DbDialect; external?: ExternalDbConfig; rootDir: string } {
  const resolved = resolveDbDialect(env);
  const rootDir = env.DATA_DIR?.trim() || process.cwd();
  return { ...resolved, rootDir };
}

// ── Decisión de dialecto: UNA vez por proceso (arranque) ─────────────────────
//
// La comprobación de DATABASE_URL/DB_URL/DB_* se hace una sola vez (la primera
// consulta aquí, que en la práctica es el arranque del servidor) y el resultado
// queda CONGELADO en memoria hasta que la app se reinicie. Mientras la app corre
// NO se re-lee ninguna variable: no cambia de sqlite↔mysql a mitad de ejecución.

let cachedResolution:
  | { dialect: DbDialect; external?: ExternalDbConfig; rootDir: string }
  | undefined;

/**
 * Configuración de persistencia efectiva del proceso: sqlite por defecto, o
 * MySQL/MariaDB externa si en el arranque había DATABASE_URL/DB_URL/DB_*
 * completa. Devuelve SIEMPRE el mismo objeto (resuelto una vez, congelado).
 */
export function getPersistenceConfig(
  env: NodeJS.ProcessEnv = process.env
): { dialect: DbDialect; external?: ExternalDbConfig; rootDir: string } {
  if (!cachedResolution) {
    cachedResolution = databaseConfigFromEnv(env);
  }
  return cachedResolution;
}