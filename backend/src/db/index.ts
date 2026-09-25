// Folder: backend/src/db
// Selector de persistencia: `DB_TYPE` es el ÚNICO selector y es OBLIGATORIO.
// Se resuelve UNA vez al arranque y queda congelado hasta reiniciar.
//
//   - DB_TYPE=sqlite                             → sqlite interno (catalogai.db bajo
//                                                  DATA_DIR; si DATA_DIR no existe,
//                                                  se usa la ubicación por defecto)
//   - DB_TYPE=mysql|mariadb + DB_* completos     → MySQL/MariaDB externo
//   - DB_TYPE=mysql|mariadb sin DB_* completos   → error claro en el arranque
//   - DB_TYPE ausente o dialecto no soportado    → error claro en el arranque
//
// No existe DATABASE_URL/DB_URL: una sola variable decide el motor y el resto
// solo configura el motor elegido. El driver concreto (sql.js para sqlite,
// worker+mysql2 para mysql) vive en db/drivers; aquí solo se decide el destino.

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
 * Resuelve el dialecto objetivo a partir del entorno. `DB_TYPE` es obligatorio;
 * sin él, o con una config externa incompleta o un dialecto no servible, lanza
 * con un mensaje claro para que la app no arranque a medias.
 */
export function resolveDbDialect(
  env: NodeJS.ProcessEnv = process.env
): { dialect: DbDialect; external?: ExternalDbConfig } {
  const type = env.DB_TYPE?.trim().toLowerCase();

  if (type === 'sqlite') {
    return { dialect: 'sqlite' };
  }

  if (type === 'mysql' || type === 'mariadb') {
    const host = env.DB_HOST?.trim();
    const portRaw = env.DB_PORT?.trim();
    const database = env.DB_NAME?.trim();
    const user = env.DB_USER?.trim();
    const missing: string[] = [];
    if (!host) missing.push('DB_HOST');
    if (!database) missing.push('DB_NAME');
    if (!user) missing.push('DB_USER');
    if (env.DB_PASSWORD === undefined) missing.push('DB_PASSWORD');
    if (missing.length > 0) {
      throw new Error(
        `DB_TYPE=${type} no arranca: falta ${missing.join(', ')}. ` +
          `Define DB_HOST/DB_NAME/DB_USER/DB_PASSWORD (DB_PORT opcional, default 3306).`
      );
    }
    return {
      dialect: 'mysql',
      external: {
        host: host!,
        port: portRaw ? Number(portRaw) : 3306,
        database: database!,
        user: user!,
        password: env.DB_PASSWORD!.trim(),
        ssl: env.DB_SSL?.trim() ? isTruthy(env.DB_SSL) : undefined,
        maxPool: env.DB_MAX_POOL?.trim() ? Number(env.DB_MAX_POOL) : undefined
      }
    };
  }

  if (type) {
    throw new Error(
      `DB_TYPE="${type}" no está soportado. Soportado: sqlite, mysql, mariadb.`
    );
  }

  throw new Error(
    'DB_TYPE es obligatorio: sqlite (base de datos interna) o mysql/mariadb (externa).'
  );
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
// La comprobación de DB_TYPE/DB_* se hace una sola vez (la primera consulta
// aquí, que en la práctica es el arranque del servidor) y el resultado queda
// CONGELADO en memoria hasta que la app se reinicie. Mientras la app corre NO
// se re-lee ninguna variable: no cambia de sqlite↔mysql a mitad de ejecución.

let cachedResolution:
  | { dialect: DbDialect; external?: ExternalDbConfig; rootDir: string }
  | undefined;

/**
 * Configuración de persistencia efectiva del proceso: la que decida `DB_TYPE`
 * al arranque (sqlite interno o MySQL/MariaDB externa). Devuelve SIEMPRE el
 * mismo objeto (resuelto una vez, congelado).
 */
export function getPersistenceConfig(
  env: NodeJS.ProcessEnv = process.env
): { dialect: DbDialect; external?: ExternalDbConfig; rootDir: string } {
  if (!cachedResolution) {
    cachedResolution = databaseConfigFromEnv(env);
  }
  return cachedResolution;
}