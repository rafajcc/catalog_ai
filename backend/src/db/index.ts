// Folder: backend/src/db
// Adapter de persistencia: UNA interfaz (run/queryAll/queryOne/close) que el
// resto del backend ya usa, resuelta contra SQL crudo de SQLite (interna por
// defecto) o de MySQL/MariaDB (externa cuando hay DATABASE_URL/DB_*).
//
// Fase 1 (este fichero): solo define el contrato y el selector de dialecto.
// NINGÚN módulo de negocio enruta todavvía a través de él; la app sigue
// usando sql.js como hoy. Las fases siguientes conectan los módulos de datos.

// ── Contrato (idéntico a lo que auth/database.ts ya expone) ─────────────────

export interface DbClient {
  run(sql: string, params?: unknown[]): void;
  queryAll<T = Record<string, unknown>>(sql: string, params?: unknown[]): T[];
  queryOne<T = Record<string, unknown>>(sql: string, params?: unknown[]): T | undefined;
  close(): void;
}

// ── Configuración ───────────────────────────────────────────────────────────

export type DbDialect = 'sqlite' | 'mysql';

export interface ExternalDbConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

/**
 * Resuelve el dialecto objetivo a partir del entorno.
 *  - DATABASE_URL o DB_HOST+DB_PORT+DB_NAME+DB_USER(+DB_PASSWORD) → mysql
 *  - nada / solo DATA_DIR → sqlite (default)
 *  - configuración externa incompleta → lanza error claro (no arranque tonto)
 */
export function resolveDbDialect(
  env: NodeJS.ProcessEnv = process.env
): { dialect: DbDialect; external?: ExternalDbConfig } {
  const url = env.DATABASE_URL?.trim();
  if (url) {
    if (url.startsWith('mysql://') || url.startsWith('mariadb://')) {
      return { dialect: 'mysql', external: parseMysqlUrl(url) };
    }
    // Cualquier otro proveedor explícito que no sepamos servir → error claro.
    throw new Error(
      `DATABASE_URL apunta a un dialecto no soportado todavía (${url.split(':')[0]}). ` +
        `Soportado: mysql:// o mariadb://. Sin DATABASE_URL se usa sqlite interno.`
    );
  }

  const host = env.DB_HOST?.trim();
  const portRaw = env.DB_PORT?.trim();
  const database = env.DB_NAME?.trim();
  const user = env.DB_USER?.trim();
  if (host || portRaw || database || user) {
    const missing: string[] = [];
    if (!host) missing.push('DB_HOST');
    if (!portRaw) missing.push('DB_PORT');
    if (!database) missing.push('DB_NAME');
    if (!user) missing.push('DB_USER');
    // DB_PASSWORD es obligatoria para conectarse; sin ella tampoco hay mysql.
    if (!env.DB_PASSWORD?.trim()) missing.push('DB_PASSWORD');
    if (missing.length > 0) {
      throw new Error(
        `Configuración externa incompleta. Faltan: ${missing.join(', ')}. ` +
          `Define DATABASE_URL completa o DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD. ` +
          `Sin configuración externa se usa sqlite interno.`
      );
    }
    return {
      dialect: 'mysql',
      external: {
        host,
        port: portRaw ? Number(portRaw) : 3306,
        database,
        user,
        password: env.DB_PASSWORD!.trim()
      }
    };
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

export function databaseConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env
): { dialect: DbDialect; external?: ExternalDbConfig; rootDir: string } {
  const resolved = resolveDbDialect(env);
  const rootDir = env.DATA_DIR?.trim() || process.cwd();
  return { ...resolved, rootDir };
}

// ── Decisión de dialecto: UNA vez por proceso (arranque) ─────────────────────
//
// La comprobación de DATABASE_URL/DB_* se hace una sola vez (la primera consulta
// aquí, que en la práctica es el arranque del servidor) y el resultado queda
// CONGELADO en memoria hasta que la app se reinicie. Mientras la app corre NO se
// re-lee ninguna variable: no cambia de sqlite↔mysql a mitad de ejecución.

let cachedResolution:
  | { dialect: DbDialect; external?: ExternalDbConfig; rootDir: string }
  | undefined;

/**
 * Configuración de persistencia efectiva del proceso: sqlite por defecto, o
 * MySQL/MariaDB externa si en el arranque había DATABASE_URL/DB_* completa.
 * Devuelve SIEMPRE el mismo objeto (resuelto una vez, congelado hasta restart).
 */
export function getPersistenceConfig(
  env: NodeJS.ProcessEnv = process.env
): { dialect: DbDialect; external?: ExternalDbConfig; rootDir: string } {
  if (!cachedResolution) {
    cachedResolution = databaseConfigFromEnv(env);
  }
  return cachedResolution;
}
