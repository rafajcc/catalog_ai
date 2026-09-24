// Folder: backend/src/db/drivers
// Cobertura del driver MySQL/MariaDB síncrono.
//  - translateMysqlQuery: convierte los giros SQLite del dominio a MySQL SIN
//    tocar el SQL de negocio (bloque puro, sin servidor).
//  - createMysqlClient: prueba el cableado worker_threads + mysql2 y la
//    propagación síncrona de errores de conexión (puerto 1 en loopback = nada
//    escuchando, conexión rechazada al instante).
//  - integración opcional: cuando MYSQL_TEST_URL=mysql://user:pass@host:port/db
//    está definida, se ejecuta el bootstrap real de initDatabase + primer ciclo
//    de escritura/lectura contra ese servidor.

import { translateMysqlQuery, createMysqlClient } from './mysql';
import { getPersistenceConfig } from '../index';
import { seedImageProviders } from '../../modules/image-providers/registry';

describe('translateMysqlQuery', () => {
  it('INSERT OR IGNORE → INSERT IGNORE', () => {
    expect(
      translateMysqlQuery('INSERT OR IGNORE INTO marketplaces (name) VALUES (?)')
    ).toBe('INSERT IGNORE INTO marketplaces (name) VALUES (?)');
  });

  it('upsert ON CONFLICT ... DO UPDATE SET con excluded → ON DUPLICATE KEY UPDATE con VALUES()', () => {
    const sql = `INSERT INTO app_settings (comercio_id, setting_key, setting_value)
      VALUES (?, ?, ?)
      ON CONFLICT(comercio_id, setting_key) DO UPDATE SET
        setting_value = excluded.setting_value,
        updated_at = datetime('now')`;
    const translated = translateMysqlQuery(sql);
    expect(translated).toContain('ON DUPLICATE KEY UPDATE');
    expect(translated).toContain('setting_value = VALUES(setting_value)');
    expect(translated).toContain('updated_at = CURRENT_TIMESTAMP');
    expect(translated).not.toContain('excluded.');
  });

  it("datetime('now') → CURRENT_TIMESTAMP", () => {
    expect(
      translateMysqlQuery("UPDATE comercios SET active = ?, updated_at = datetime('now') WHERE id = ?")
    ).toBe('UPDATE comercios SET active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
  });

  it("datetime('now','-' || ? || ' minutes') → DATE_SUB(NOW(), INTERVAL ? MINUTE)", () => {
    const sql = `SELECT COUNT(*) as cnt FROM login_attempts
      WHERE username = ? AND success = 0
      AND attempted_at > datetime('now', '-' || ? || ' minutes')`;
    expect(translateMysqlQuery(sql)).toContain(
      "attempted_at > DATE_SUB(NOW(), INTERVAL ? MINUTE)"
    );
    expect(translateMysqlQuery(sql)).not.toContain('datetime(');
  });

  it('last_insert_rowid() → LAST_INSERT_ID()', () => {
    expect(translateMysqlQuery('SELECT last_insert_rowid() as id')).toBe(
      'SELECT LAST_INSERT_ID() as id'
    );
  });

  it('PRAGMA table_info → information_schema con alias name', () => {
    const translated = translateMysqlQuery('PRAGMA table_info(comercios)');
    expect(translated).toContain(
      'SELECT COLUMN_NAME AS name FROM information_schema.columns'
    );
    expect(translated).toContain("table_name = 'comercios'");
  });

  it('deja intacto SQL neutro (SELECT/INSERT/UPDATE sin giros sqlite)', () => {
    const sql = 'SELECT id, name FROM comercios WHERE name = ?';
    expect(translateMysqlQuery(sql)).toBe(sql);
  });
});

describe('createMysqlClient (cableado síncrono worker_threads + mysql2)', () => {
  jest.setTimeout(20000);

  it('propaga el error de conexión de forma síncrona', () => {
    // Puerto 1 en loopback: nada escucha, ECONNREFUSED inmediato. Si fallara el
    // cableado (p.ej. colgar en Atomics.wait) este test se colgaría.
    let thrown: unknown;
    try {
      createMysqlClient({
        host: '127.0.0.1',
        port: 1,
        database: 'catalogai_test',
        user: 'test',
        password: 'test'
      });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeDefined();
    const msg = thrown instanceof Error ? thrown.message : String(thrown);
    expect(msg).not.toContain('timed out');
    expect(msg).toMatch(/ECONNREFUSED|ER_ACCESS_DENIED_ERROR|connect EADDRNOTAVAIL/i);
  });
});

// Integración opcional contra un MySQL/MariaDB REAL.
//   MYSQL_TEST_URL=mysql://user:pass@127.0.0.1:3306/catalogai_test npx jest src/db/drivers/mysql.test.ts
const MYSQL_TEST_URL = process.env.MYSQL_TEST_URL?.trim();

describe('mysql driver integración real (opt-in con MYSQL_TEST_URL)', () => {
  const envUrl = MYSQL_TEST_URL;
  const runnable = envUrl ? describe : describe.skip;

  runnable('initDatabase + ciclo de negocio contra servidor', () => {
    jest.setTimeout(60000);
    beforeAll(() => {
      // El selector se consulta UNA vez (cache de módulo). Este fichero no ha
      // llamado a initDatabase antes ni usa sqlite, así que la primera llamada
      // ve el entorno con DATABASE_URL → mysql.
      process.env.DATABASE_URL = envUrl;
      const cfg = getPersistenceConfig();
      expect(cfg.dialect).toBe('mysql');
    });

    it('crea comercio, usuarios y escribe/lee config', async () => {
      // Dinámico para no colisionar en bases compartidas por CI
      const suffix = Date.now().toString(36);
      const db = await import('../../modules/auth/database');
      await db.initDatabase('');
      // En el arranque real, createApp() siembra los providers después de
      // initDatabase; la integración hace lo mismo para reflejar ese flujo.
      seedImageProviders();

      const comercio = db.createComercio(`smoke-${suffix}`);
      expect(comercio.id).toBeGreaterThan(0);
      expect(db.findComercioByName(`smoke-${suffix}`)?.id).toBe(comercio.id);

      const user = db.createUser('admin', 'hash', 'admin', comercio.id);
      expect(user.id).toBeGreaterThan(0);
      expect(db.findUserById(user.id)?.username).toBe('admin');
      expect(user.created_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);

      const provs = db.listImageProviders();
      expect(provs.length).toBeGreaterThan(0);
      expect(db.getImageProviderBySlug('mock')).toBeTruthy();

      db.setAIProviderConfigBatch(1, comercio.id, {
        api_key: 'abc',
        delete_me: null
      });
      expect(db.getAIProviderConfig(1, comercio.id)).toEqual({ api_key: 'abc' });

      db.recordLoginAttempt('nosferatu', '::1', false);
      expect(db.isAccountLocked('nosferatu')).toBe(false);

      const mps = db.listMarketplaces(comercio.id);
      expect(mps.some((m: { name: string }) => m.name === 'PrestaShop')).toBe(true);

      db.deleteComercio(comercio.id);
      expect(db.findComercioById(comercio.id)).toBeUndefined();
    });
  });
});