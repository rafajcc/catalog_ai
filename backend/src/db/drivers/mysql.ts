// Folder: backend/src/db/drivers
// Driver MySQL/MariaDB REAL sobre mysql2/promise. MISMO SQL crudo que sql.js
// (los placeholders `?` son idénticos en ambos dialectos → ni una query cambia
// de texto). MySQL es ASÍNCRONO por naturaleza, así que este driver devuelve
// Promises y NO finge un contrato síncrono: es la diferencia honesta e
// inevitable frente al sqlite interno (que es síncrono porque vive en memoria).
//
// Este fichero es la pieza "real y operativa": abre un pool de verdad contra el
// servidor, lo comprueba con un SELECT 1 real en el arranque y ejecuta SQL crudo
// con `?` cuando el selector decida dialecto `mysql`. El enrutado de los
// módulos de negocio (que hoy son síncronos) hacia estas Promises es la parte
// que tiene que decidir el tech lead, porque convierte el contrato a async.

import mysql, { type Pool } from 'mysql2/promise';

// ── Configuración ───────────────────────────────────────────────────────────

export interface MysqlConnectionSettings {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

// ── Contrato honesto (asíncrono) ────────────────────────────────────────────
//
// Mismas queries SQL crudas y mismos placeholders `?` que auth/database.ts ya
// usa contra sql.js; lo único que cambia es que el resultado llega via Promise.

export interface AsyncMysqlClient {
  runAsync(sql: string, params?: unknown[]): Promise<void>;
  queryAllAsync<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  queryOneAsync<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | undefined>;
  close(): Promise<void>;
}

let pool: Pool | undefined;
let closed = false;

function assertOpen(): void {
  if (!pool || closed) {
    throw new Error('Cliente MySQL cerrado o no inicializado: llama a connectMysql(settings) primero.');
  }
}

/**
 * Abre el pool MySQL/MariaDB y verifica la conexión de verdad con un SELECT 1
 * (no un "conectado" mentiroso). La comprobación se hace en el arranque; si el
 * servidor no responde, el error sale aquí al primer arranque, no en mitad de
 * la primera query.
 */
export async function connectMysql(
  settings: MysqlConnectionSettings
): Promise<AsyncMysqlClient> {
  pool = mysql.createPool({
    host: settings.host,
    port: settings.port,
    database: settings.database,
    user: settings.user,
    password: settings.password,
    waitForConnections: true,
    connectionLimit: 10,
    namedPlaceholders: false,
    charset: 'utf8mb4'
  });

  closed = false;
  await pool.query('SELECT 1');

  return {
    async runAsync(sql, params = []) {
      assertOpen();
      await pool!.query(sql, params);
    },
    async queryAllAsync(sql, params = []) {
      assertOpen();
      const [rows] = await pool!.query(sql, params);
      return rows as Record<string, unknown>[];
    },
    async queryOneAsync(sql, params = []) {
      assertOpen();
      const [rows] = await pool!.query(sql, params);
      const list = rows as Record<string, unknown>[];
      return list[0];
    },
    async close() {
      if (!pool || closed) return;
      closed = true;
      await pool.end();
      pool = undefined;
    }
  };
}
