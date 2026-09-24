# BD_PLAN.md — sqlite interna por defecto ↔ MySQL/MariaDB (+Postgres) si config externa

> Fichero de plan temporal. Se **elimina** al terminar la implementación.
> No es documentación permanente.

## Objetivo (según tu decisión)

- **Sin config de BD** (o solo `DATA_DIR`) → **sqlite interna** en `dataDir`
  (comportamiento actual, sin cambios).
- **Con config de BD** (`DATABASE_URL` MySQL/MariaDB/Postgres, o
  `DB_HOST+DB_PORT+DB_NAME+DB_USER+DB_PASSWORD`) → **BD externa** a esa base.
- **Mismo SQL crudo en todos los casos** (sql.js ↔ drivers externos), sin ORM,
  sin Drizzle, sin Prisma, sin DSL, sin capa nueva de datos.
- Postgres: **solo si el esfuerzo es mínimo** (mismo adaptador, cambia driver y
  dialecto). Si resulta complejo, queda solo MySQL/MariaDB y Postgres se anota
  como extensión futura.

## La única pieza nueva: adaptador de persistencia SQL crudo

Hoy todo usa 3 primitivas sobre sql.js: `db.run`, `db.queryAll`, `db.queryOne`
(operadas en `backend/src/modules/auth/database.ts` vía `_DB` sql.js). Se
extrae un adaptador mínimo con **la misma interfaz** y **el mismo SQL crudo**:

- **sqlite (default)** → sql.js tal cual hoy (dataDir).
- **MySQL/MariaDB** → `mysql2`, mismas queries SQL crudas (solo cambian
  placeholders `?`→`?`/`$1` si hiciera falta — se normaliza en el adaptador).
- **Postgres (si mínimo)** → `pg`, mismas queries.

Firma pública del adaptador (idéntica a la actual):
`run / queryAll / queryOne / close`. Los módulos de negocio **no cambian**:
siguen escribiendo SQL crudo; solo cambia sobre qué driver se ejecuta, elegido
por configuración en un único punto de arranque.

## Decisiones

Drizzle/Prisma: **descartados** (complejidad sin beneficio aquí; el tech lead
lo confirmó). SQL crudo en los 3 dialectos. Migraciones: las actuales
(`schema_version` + `CREATE TABLE IF NOT EXISTS`) se mantienen; el adaptador
incluye listar/aplicar los mismos DDL en el dialecto externo.

## Fases (una commit+push verificada cada una)

1. **Adaptador** — `backend/src/db/` con `sqlite.ts` (driver sql.js actual) +
   `mysql.ts` (mysql2) + selector `createDbDriver(env)`: sqlite por defecto,
   externa si hay `DATABASE_URL`/`DB_*`. Válido: tsc + suite sqlite verde.
2. **Enrutar BD existente** — `auth/database.ts` y demás módulos de datos
   pasan a usar el adaptador (SQL igual, solo cambia el destino). Válido:
   suite completa verde (sqlite default). Commit+push.
3. **Config externa** — leer `DATABASE_URL`/`DB_*`; incompleta → error claro de
   arranque; completa externa → mysql; sin config → sqlite. Docs
   actualizadas. Válido: suite verde + arranques manuales. Commit+push.
4. **Postgres (solo si mínimo)** — driver `pg` en el adaptador + selector
   esquema `postgres`. Si requiere cambios grandes: **se omite** y se anota en
   docs como futuro. Válido: suite verde + humo manual si hay entorno.
5. **Tests/cierre** — cobertura del selector (3 estados), suite completa verde,
   borrar `BD_PLAN.md`, revisión final, commit+push a `origin/main`.
