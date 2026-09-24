// Folder: backend/src/db/drivers
// Driver MySQL/MariaDB REAL e SÍNCRONO para la capa de persistencia actual.
//
// El resto del backend (auth/database.ts y los módulos de negocio) es
// síncrono y habla con sql.js usando run/queryAll/queryOne. Este driver ofrece
// ESA MISMA interfaz síncrona contra un MySQL/MariaDB real, de modo que no hay
// que tocar ni una query de negocio ni ninguna firma pública.
//
// Cómo se consigue "síncrono" con un driver nativamente asíncrono (mysql2):
// la conexión real vive en un worker_threads aparte y el hilo principal
// bloquea (Atomics.wait) hasta que el worker responde. Es el mismo patrón que
// usan sync-mysql/sync-rpc. La app ya es de un solo hilo para la BD (sql.js
// es síncrono), así que el modelo de "una conexión, llamadas serializadas" es
// idéntico al actual y LAST_INSERT_ID() funciona como en sqlite.
//
// El SQL crudo de la base de negocio NO cambia: este driver traduce en el
// límite los poquísimos giros específicos de SQLite que usa el dominio
// (INSERT OR IGNORE, ON CONFLICT ... DO UPDATE, datetime('now'),
// last_insert_rowid(), PRAGMA table_info) a su equivalente MySQL.

import { Worker, MessageChannel, receiveMessageOnPort, MessagePort } from 'worker_threads';

// ── Configuración ───────────────────────────────────────────────────────────

export interface MysqlConnectionSettings {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl?: boolean;
  maxPool?: number;
}

// ── Traducción de SQL (los giros SQLite que usa el dominio → MySQL) ────────

// Orden importante:
//  1. la variante con DATE_SUB se sustituye ANTES que el datetime('now') genérico
//     (es un prefijo del patrón genérico y usa un placeholder distinto),
//  2. el bloque ON CONFLICT(...) DO UPDATE SET se convierte antes de tocar los
//     `excluded.x` (que solo aparecen en su SET-clause).
export function translateMysqlQuery(sql: string): string {
  let out = sql;

  out = out.replace(
    /datetime\('now',\s*'-'\s*\|\|\s*\?\s*\|\|\s*' minutes'\)/gi,
    'DATE_SUB(NOW(), INTERVAL ? MINUTE)'
  );

  out = out.replace(/INSERT\s+OR\s+IGNORE\s+INTO/gi, 'INSERT IGNORE INTO');

  out = out.replace(
    /ON\s+CONFLICT\s*\([^)]*\)\s*DO\s+UPDATE\s+SET/gi,
    'ON DUPLICATE KEY UPDATE'
  );

  out = out.replace(
    /\bexcluded\.([a-zA-Z0-9_]+)\b/g,
    (_match, col: string) => `VALUES(${col})`
  );

  out = out.replace(/datetime\('now'\)/gi, 'CURRENT_TIMESTAMP');

  out = out.replace(/last_insert_rowid\(\)/gi, 'LAST_INSERT_ID()');

  // PRAGMA table_info(x) devuelve filas con columna `name`; en MySQL se resuelve
  // contra information_schema con la MISMA forma (rows con `name`).
  out = out.replace(
    /PRAGMA\s+table_info\(\s*([a-zA-Z0-9_]+)\s*\)/gi,
    (_match, table: string) =>
      `SELECT COLUMN_NAME AS name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = '${table}'`
  );

  return out;
}

// ── Esquema MySQL (traducción 1:1 del SCHEMA de sqlite) ─────────────────────
//
// Mismas tablas, mismas columnas, mismos índices y mismas restricciones. Las
// fechas se guardan como DATETIME (con timezone UTC vía `timezone:'Z'`) que el
// driver devuelve como 'YYYY-MM-DD HH:MM:SS' igual que sqlite; las columnas
// que guardan ISO con 'Z' (expires_at) y fechas de ciclo ('YYYY-MM-DD') siguen
// siendo VARCHAR para no perder el texto exacto que escribe el dominio.

const MYSQL_SCHEMA_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS comercios (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    active TINYINT NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL,
    comercio_id INT NOT NULL,
    must_change_password TINYINT NOT NULL DEFAULT 0,
    active TINYINT NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (comercio_id) REFERENCES comercios(id) ON DELETE CASCADE,
    UNIQUE (username, comercio_id)
  )`,
  `CREATE TABLE IF NOT EXISTS login_attempts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(255) NOT NULL,
    ip_address VARCHAR(64),
    attempted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    success TINYINT DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS registration_nonces (
    id INT AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(32) UNIQUE NOT NULL,
    expires_at VARCHAR(40) NOT NULL,
    active TINYINT NOT NULL DEFAULT 1,
    used TINYINT NOT NULL DEFAULT 0,
    used_by_comercio_id INT,
    created_by VARCHAR(255),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS marketplaces (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) UNIQUE NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS ai_providers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) UNIQUE NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS comercio_marketplaces (
    comercio_id INT NOT NULL,
    marketplace_id INT NOT NULL,
    enabled TINYINT DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (comercio_id, marketplace_id),
    FOREIGN KEY (comercio_id) REFERENCES comercios(id) ON DELETE CASCADE,
    FOREIGN KEY (marketplace_id) REFERENCES marketplaces(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS comercio_ai_providers (
    comercio_id INT NOT NULL,
    ai_provider_id INT NOT NULL,
    enabled TINYINT DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (comercio_id, ai_provider_id),
    FOREIGN KEY (comercio_id) REFERENCES comercios(id) ON DELETE CASCADE,
    FOREIGN KEY (ai_provider_id) REFERENCES ai_providers(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS marketplace_config (
    id INT AUTO_INCREMENT PRIMARY KEY,
    comercio_id INT NOT NULL,
    marketplace_id INT NOT NULL,
    config_key VARCHAR(255) NOT NULL,
    config_value TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (comercio_id) REFERENCES comercios(id) ON DELETE CASCADE,
    FOREIGN KEY (marketplace_id) REFERENCES marketplaces(id) ON DELETE CASCADE,
    UNIQUE (comercio_id, marketplace_id, config_key)
  )`,
  `CREATE TABLE IF NOT EXISTS ai_provider_config (
    id INT AUTO_INCREMENT PRIMARY KEY,
    comercio_id INT NOT NULL,
    ai_provider_id INT NOT NULL,
    config_key VARCHAR(255) NOT NULL,
    config_value TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (comercio_id) REFERENCES comercios(id) ON DELETE CASCADE,
    FOREIGN KEY (ai_provider_id) REFERENCES ai_providers(id) ON DELETE CASCADE,
    UNIQUE (comercio_id, ai_provider_id, config_key)
  )`,
  `CREATE TABLE IF NOT EXISTS app_settings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    comercio_id INT NOT NULL,
    setting_key VARCHAR(255) NOT NULL,
    setting_value TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (comercio_id) REFERENCES comercios(id) ON DELETE CASCADE,
    UNIQUE (comercio_id, setting_key)
  )`,
  `CREATE TABLE IF NOT EXISTS image_providers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    slug VARCHAR(64) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    enabled TINYINT NOT NULL DEFAULT 0,
    config VARCHAR(4096) NOT NULL DEFAULT '{}',
    billing_cycle_day INT,
    calls_this_cycle INT NOT NULL DEFAULT 0,
    cycle_start VARCHAR(16),
    last_called TINYINT NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS provider_feed_images (
    id INT AUTO_INCREMENT PRIMARY KEY,
    brand VARCHAR(255) NOT NULL,
    reference VARCHAR(255),
    ean VARCHAR(64),
    image_url TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`
];

// MySQL no soporta CREATE INDEX IF NOT EXISTS: se crea con guarda previa.
const MYSQL_INDEXES: Array<{ name: string; ddl: string }> = [
  {
    name: 'idx_provider_feed_images_brand_ref_ean',
    ddl:
      'CREATE INDEX idx_provider_feed_images_brand_ref_ean ' +
      'ON provider_feed_images (brand, reference, ean)'
  }
];

// ── Worker: la conexión MySQL real vive en otro hilo ────────────────────────
//
// El worker recibe { id, kind, sql, params }, ejecuta la query con mysql2 y
// responde { id, result } o { id, error }. Después avisa al hilo principal con
// Atomics.notify para que salga del wait síncrono.

const WORKER_SOURCE = [
  'const workerData = require(\'node:worker_threads\').workerData;',
  'const port = workerData.port;',
  'const settings = workerData.settings;',
  'const mysql = require(workerData.mysql2Path);',
  'const LOCK = new Int32Array(workerData.sab);',
  'let conn = null;',
  '',
  'async function ensureConn() {',
  '  if (conn) return;',
  '  conn = await mysql.createConnection({',
  "    host: settings.host || 'localhost',",
  '    port: settings.port || 3306,',
  '    database: settings.database,',
  '    user: settings.user,',
  '    password: settings.password,',
'    connectTimeout: 10000,',
"    charset: 'utf8mb4',",
"    timezone: 'Z',",
'    flags: [\'FOUND_ROWS\'],',
'    ssl: settings.ssl ? {} : undefined,',
  '    typeCast: function (field, next) {',
  "      if (field.type === 'DATETIME' || field.type === 'TIMESTAMP' || field.type === 'DATE') {",
  '        return field.string();',
  '      }',
  '      return next();',
  '    }',
  '  });',
  '}',
  '',
  'async function runMessage(msg) {',
  '  try {',
  '    await ensureConn();',
  '    if (msg.kind === \'close\') {',
  '      try { await conn.end(); } catch (e) {}',
  '      process.exit(0);',
  '      return;',
  '    }',
  '    const [data] = await conn.query(msg.sql, msg.params || []);',
  '    let result;',
  "    if (msg.kind === 'run') {",
  '      result = { changes: data.affectedRows, lastInsertRowid: data.insertId };',
  "    } else if (msg.kind === 'queryAll') {",
  '      result = data;',
  '    } else {',
  '      result = data[0];',
  '    }',
  '    port.postMessage({ id: msg.id, result });',
  '  } catch (err) {',
  '    const es = err instanceof Error ? err : new Error(String(err));',
  '    const code = (err && typeof err === \'object\' && \'code\' in err) ? err.code : undefined;',
  '    const errno = (err && typeof err === \'object\' && \'errno\' in err) ? err.errno : undefined;',
  '    port.postMessage({',
  '      id: msg.id,',
  '      error: { message: es.message, code: code, errno: errno }',
  '    });',
  '  } finally {',
  '    Atomics.store(LOCK, 0, 1);',
  '    Atomics.notify(LOCK, 0);',
  '  }',
  '}',
  '',
  'port.on(\'message\', function (msg) {',
  '  runMessage(msg);',
  '});'
].join('\n');

// ── Cliente síncrono ────────────────────────────────────────────────────────

export interface SyncMysqlClient {
  run(sql: string, params?: unknown[]): { changes: number; lastInsertRowid?: number };
  queryAll<T = Record<string, unknown>>(sql: string, params?: unknown[]): T[];
  queryOne<T = Record<string, unknown>>(sql: string, params?: unknown[]): T | undefined;
  applySchema(): void;
  close(): void;
}

const QUERY_TIMEOUT_MS = 30000;

// eslint-disable-next-line @typescript-eslint/no-var-requires
const MYSQL2_RESOLVED = (() => {
  try {
    return require.resolve('mysql2/promise');
  } catch {
    return 'mysql2/promise';
  }
})();

export function createMysqlClient(settings: MysqlConnectionSettings): SyncMysqlClient {
  let worker: Worker | undefined;
  const sab = new SharedArrayBuffer(4);
  const LOCK = new Int32Array(sab);
  let sequence = 0;

  function spawnWorker(): Worker {
    const { port1, port2 } = new MessageChannel();
    const w = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: {
        settings,
        mysql2Path: MYSQL2_RESOLVED,
        sab,
        port: port2
      },
      transferList: [port2]
    });
    w.unref();
    w.on('error', () => {
      worker = undefined;
    });
    w.on('exit', () => {
      worker = undefined;
    });
    // Guardamos el port1 para leer las respuestas de forma síncrona.
    (w as unknown as { __syncPort: MessagePort }).__syncPort = port1;
    return w;
  }

  function ensureWorker(): Worker {
    if (worker) return worker;
    worker = spawnWorker();
    return worker;
  }

  function call(kind: 'run' | 'queryAll' | 'queryOne', sql: string, params: unknown[]): unknown {
    const id = ++sequence;
    const deadline = Date.now() + QUERY_TIMEOUT_MS;
    // Se aplica la traducción SQLite→MySQL SIEMPRE (también en queries sueltas:
    // el dominio escribe en SQLite, este driver normaliza).
    let result: unknown;
    let error: unknown;
    for (;;) {
      const w = ensureWorker();
      const syncPort = (w as unknown as { __syncPort: MessagePort }).__syncPort;
      Atomics.store(LOCK, 0, 0);
      try {
        syncPort.postMessage({ id, kind, sql: translateMysqlQuery(sql), params });
      } catch {
        // El worker murió entre medio: se reinicia en la siguiente iteración.
        worker = undefined;
        if (Date.now() > deadline) {
          throw new Error(`MySQL query timed out after ${QUERY_TIMEOUT_MS}ms`);
        }
        continue;
      }
      for (;;) {
        const event = receiveMessageOnPort(syncPort);
        if (event && event.message && event.message.id === id) {
          if (event.message.error) {
            error = new Error(
              `${event.message.error.code ? event.message.error.code + ': ' : ''}${event.message.error.message}`
            );
          } else {
            result = event.message.result;
          }
          break;
        }
        if (Date.now() > deadline) {
          throw new Error(`MySQL query timed out after ${QUERY_TIMEOUT_MS}ms`);
        }
        Atomics.wait(LOCK, 0, 0, 100);
      }
      break;
    }
    if (error) throw error;
    return result;
  }

  // Comprobación de conexión real en el arranque (SELECT 1), igual que la app
  // espera: si el servidor no responde, falla aquí y no a mitad de la primera
  // query.
  call('queryOne', 'SELECT 1', []);

  const client: SyncMysqlClient = {
    run(sql: string, params: unknown[] = []): { changes: number; lastInsertRowid?: number } {
      return call('run', sql, params) as { changes: number; lastInsertRowid?: number };
    },
    queryAll<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T[] {
      return call('queryAll', sql, params) as T[];
    },
    queryOne<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T | undefined {
      return call('queryOne', sql, params) as T | undefined;
    },
    applySchema(): void {
      for (const statement of MYSQL_SCHEMA_STATEMENTS) {
        call('run', statement, []);
      }
      for (const index of MYSQL_INDEXES) {
        const exists = call(
          'queryOne',
          'SELECT 1 AS present FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?',
          ['provider_feed_images', index.name]
        ) as { present: number } | undefined;
        if (!exists) {
          call('run', index.ddl, []);
        }
      }
    },
    close(): void {
      if (worker) {
        const syncPort = (worker as unknown as { __syncPort: MessagePort }).__syncPort;
        try {
          syncPort.postMessage({ id: ++sequence, kind: 'close', sql: '', params: [] });
        } catch {
          // ya está cerrado
        }
        worker.terminate();
        worker = undefined;
      }
    }
  };

  return client;
}

export { MYSQL_SCHEMA_STATEMENTS as MYSQL_SCHEMA };