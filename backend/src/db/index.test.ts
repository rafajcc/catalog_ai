// Folder: backend/src/db
// Cobertura del selector de persistencia (BD_PLAN.md fases 1 y 3). Verifica que
// la resolución del dialecto se decide a partir del entorno y se CONGELA una
// única vez por proceso, tal como exige el requisito "elegir UNA vez al arranque".
// Solo se ejercitan funciones puras (resolveDbDialect / databaseConfigFromEnv);
// ninguna toca un servidor real ni módulos de negocio.

import {
  resolveDbDialect,
  databaseConfigFromEnv,
  DbDialect
} from './index';

describe('db selector de dialecto de persistencia', () => {
  it('sqlite (default) cuando no hay DATABASE_URL ni DB_*', () => {
    const c = resolveDbDialect({});
    expect(c.dialect as DbDialect).toBe('sqlite');
    expect(c.external).toBeUndefined();
  });

  it('mysql externo cuando DATABASE_URL es mysql:// completa', () => {
    const c = resolveDbDialect({
      DATABASE_URL: 'mysql://user:pass@dbhost:3307/catdb'
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

  it('mysql externo cuando hay DB_HOST/DB_PORT/DB_NAME/DB_USER completos', () => {
    const c = resolveDbDialect({
      DB_HOST: 'dbhost',
      DB_PORT: '3306',
      DB_NAME: 'catdb',
      DB_USER: 'user',
      DB_PASSWORD: 'pass'
    });
    expect(c.dialect).toBe('mysql');
    expect(c.external).toMatchObject({
      host: 'dbhost',
      port: 3306,
      database: 'catdb',
      user: 'user'
    });
  });

  it('DB_PORT es opcional y usa 3306 por defecto', () => {
    const c = resolveDbDialect({
      DB_HOST: 'dbhost',
      DB_NAME: 'catdb',
      DB_USER: 'user',
      DB_PASSWORD: 'pass'
    });
    expect(c.dialect).toBe('mysql');
    expect(c.external).toMatchObject({ host: 'dbhost', port: 3306 });
  });

  it('DB_URL se acepta como alias de DATABASE_URL', () => {
    const c = resolveDbDialect({
      DB_URL: 'mysql://u:p@dbhost:3307/catdb'
    });
    expect(c.dialect).toBe('mysql');
    expect(c.external).toEqual({
      host: 'dbhost',
      port: 3307,
      database: 'catdb',
      user: 'u',
      password: 'p'
    });
  });

  it('DB_TYPE=sqlite fuerza sqlite y se ignoran variables externas residuales', () => {
    const c = resolveDbDialect({
      DB_TYPE: 'sqlite',
      DATABASE_URL: 'mysql://u:p@dbhost/catdb',
      DB_HOST: 'dbhost'
    });
    expect(c.dialect).toBe('sqlite');
    expect(c.external).toBeUndefined();
  });

  it('DB_TYPE=mysql sin URL ni DB_* → error claro', () => {
    expect(() => resolveDbDialect({ DB_TYPE: 'mysql' })).toThrow(/requiere DATABASE_URL\/DB_URL/);
  });

  it('DB_TYPE no soportado → error claro', () => {
    expect(() => resolveDbDialect({ DB_TYPE: 'postgres' })).toThrow(/no está soportado/);
  });

  it('config externa incompleta → error claro (no arranque tonto)', () => {
    expect(() =>
      resolveDbDialect({ DB_HOST: 'dbhost', DB_NAME: 'catdb' })
    ).toThrow(/DB_(NAME|USER|HOST)/);
  });

  it('DATABASE_URL de dialecto no soportado → error claro', () => {
    expect(() => resolveDbDialect({ DATABASE_URL: 'postgres://u:p@h/d' })).toThrow(
      /dialecto no soportado/
    );
  });

  it('databaseConfigFromEnv añade rootDir y mantiene dialecto sqlite por defecto', () => {
    const c = databaseConfigFromEnv({});
    expect(c.dialect).toBe('sqlite');
    expect(typeof c.rootDir).toBe('string');
  });
});
