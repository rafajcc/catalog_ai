// Folder: backend/src/db
// Cobertura del selector de persistencia. Verifica que DB_TYPE es el ÚNICO y
// OBLIGATORIO selector de dialecto: sqlite interno o MySQL/MariaDB externo, y
// que la config externa incompleta (o la ausencia de DB_TYPE) impide arrancar.
// Solo se ejercitan funciones puras (resolveDbDialect / databaseConfigFromEnv);
// ninguna toca un servidor real ni módulos de negocio.

import {
  resolveDbDialect,
  databaseConfigFromEnv,
  DbDialect
} from './index';

describe('db selector de dialecto de persistencia (DB_TYPE obligatorio)', () => {
  it('SQLite interno cuando DB_TYPE=sqlite (sin DATA_DIR usa la ubicación por defecto)', () => {
    const c = resolveDbDialect({ DB_TYPE: 'sqlite' });
    expect(c.dialect as DbDialect).toBe('sqlite');
    expect(c.external).toBeUndefined();
  });

  it('DB_TYPE=sqlite ignora las variables externas residuales', () => {
    const c = resolveDbDialect({
      DB_TYPE: 'sqlite',
      DB_HOST: 'dbhost',
      DB_NAME: 'catdb',
      DB_USER: 'user',
      DB_PASSWORD: 'pass'
    });
    expect(c.dialect).toBe('sqlite');
    expect(c.external).toBeUndefined();
  });

  it('Externo con DB_TYPE=mysql y DB_* completos', () => {
    const c = resolveDbDialect({
      DB_TYPE: 'mysql',
      DB_HOST: 'dbhost',
      DB_PORT: '3307',
      DB_NAME: 'catdb',
      DB_USER: 'user',
      DB_PASSWORD: 'pass'
    });
    expect(c.dialect).toBe('mysql');
    expect(c.external).toEqual({
      host: 'dbhost',
      port: 3307,
      database: 'catdb',
      user: 'user',
      password: 'pass'
    });
  });

  it('DB_TYPE=mariadb también selecciona el dialecto mysql', () => {
    const c = resolveDbDialect({
      DB_TYPE: 'mariadb',
      DB_HOST: 'dbhost',
      DB_NAME: 'catdb',
      DB_USER: 'u',
      DB_PASSWORD: 'p'
    });
    expect(c.dialect).toBe('mysql');
  });

  it('DB_PORT es opcional y usa 3306 por defecto', () => {
    const c = resolveDbDialect({
      DB_TYPE: 'mysql',
      DB_HOST: 'dbhost',
      DB_NAME: 'catdb',
      DB_USER: 'user',
      DB_PASSWORD: 'pass'
    });
    expect(c.dialect).toBe('mysql');
    expect(c.external).toMatchObject({ host: 'dbhost', port: 3306 });
  });

  it('DB_TYPE ausente o vacío → no arranca (selector obligatorio)', () => {
    expect(() => resolveDbDialect({})).toThrow(/Falta el parámetro obligatorio DB_TYPE/);
    expect(() => resolveDbDialect({ DB_TYPE: ' ' })).toThrow(/Falta el parámetro obligatorio DB_TYPE/);
  });

  it('DB_TYPE no soportado → error claro', () => {
    expect(() => resolveDbDialect({ DB_TYPE: 'postgres' })).toThrow(/no está soportado/);
  });

  it('DB_TYPE=mysql sin DB_* → no arranca y lista las variables que faltan', () => {
    expect(() => resolveDbDialect({ DB_TYPE: 'mysql' })).toThrow(/DB_HOST/);
    expect(() => resolveDbDialect({ DB_TYPE: 'mysql', DB_HOST: 'h', DB_NAME: 'd' })).toThrow(/DB_USER/);
  });

  it('DB_TYPE=mysql sin DB_PASSWORD → no arranca', () => {
    expect(() =>
      resolveDbDialect({ DB_TYPE: 'mysql', DB_HOST: 'h', DB_NAME: 'd', DB_USER: 'u' })
    ).toThrow(/DB_PASSWORD/);
  });

  it('databaseConfigFromEnv añade rootDir y mantiene el dialecto sqlite', () => {
    const c = databaseConfigFromEnv({ DB_TYPE: 'sqlite' });
    expect(c.dialect).toBe('sqlite');
    expect(typeof c.rootDir).toBe('string');
  });
});