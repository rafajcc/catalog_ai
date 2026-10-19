# Cómo añadir un marketplace

Guía paso a paso para añadir un nuevo marketplace a Catalog AI.

Desde el refactor de adaptadores, el núcleo nunca importa un marketplace concreto:
`routes.ts` solo ve el contrato `MarketplaceAdapter` y resuelve las implementaciones a
través del registro. Esta guía lista cada fichero que cambia, en orden, y las pruebas
que demuestran que funciona.

## Cómo encaja la capa

```
routes.ts / app.ts (composition root)
        │  resolveMarketplace(name, config, store, ctx)   ← inyectado, nunca construido inline
        ▼
adapters/registry.ts  ── definitions[name]  (el ÚNICO punto que ramifica por marketplace)
        ▼
adapters/<name>-adapter.ts  ── implementa MarketplaceAdapter
        │
        ├── clients/<name>-client/     transporte HTTP (código dueño de la plataforma)
        └── fetchers/<name>-fetcher/   filtros → ProductData[] (código dueño de la plataforma)
```

Dos contratos, ambos en `backend/src/modules/marketplaces/adapters/`:

- **`types.ts` → `MarketplaceAdapter`** — `name`, `testConnection()`, `fetch(filters)`,
  `getDataset()`, `clearDataset()`, `saveUpdates(updates)`, `proxyImage()`,
  `deleteImage()`. Esto es todo lo que llama el núcleo.
- **`registry.ts` → `MarketplaceCreateContext`** — inyección solo para tests:
  `clientFactories` es un `Partial<Record<RegisteredMarketplace, config => unknown>>`,
  así el contrato nunca nombra una clase de cliente concreta. En producción queda
  `undefined` y el adaptador construye su cliente real.

## 1. Nombre y tipo de configuración

- `backend/src/types.ts` — amplía la unión
  `type MarketplaceName = 'PrestaShop' | 'Shopify'` con el nuevo nombre (p. ej.
  `'WooCommerce'`) y añade una interfaz `<Name>Config` junto a `PrestaShopConfig` /
  `ShopifyConfig` con las credenciales que necesita la tienda.
- `frontend/src/types.ts` — refleja la misma unión `MarketplaceName` (y la interfaz de
  configuración) en el cliente.

`RegisteredMarketplace = MarketplaceName | 'Mock'` incorpora el nombre nuevo
automáticamente, así que el registro, la parsing de slugs y las rutas lo aceptan sin
más ediciones.

## 2. Sección en CatalogConfig

`backend/src/store.ts`:

- Añade `<name>: <Name>Config` a la interfaz `CatalogConfig` (ambas configuraciones se
  conservan para que la pantalla de ajustes muestre y pruebe cualquier marketplace en
  cualquier momento).
- Añade los valores vacíos por defecto en `defaultConfig()`.

## 3. Siembra en base de datos y habilitación por comercio

`backend/src/modules/auth/database.ts`:

- Añade `{ name: '<Name>' }` a `SEED_MARKETPLACES`. La fila se inserta de forma
  idempotente (`INSERT OR IGNORE`) al arrancar, tanto en el camino SQLite como en el de
  MySQL/MariaDB.
- La tabla `marketplace_config` es clave/valor por `marketplace_id`, así que los nuevos
  campos de credenciales **no requieren cambios de esquema**.

> **Aviso — comercios existentes.** `createComercio()` habilita todos los marketplaces
> sembrados solo para los comercios *nuevos*. `findMarketplaceByName()` hace JOIN con
> `comercio_marketplaces`, por lo que un comercio creado antes de este cambio no tiene
> fila para el marketplace nuevo y `DatabasePersistence.load()/save()` omite su sección
> sin avisar. Añade un relleno idempotente al arrancar (y pruébalo), por ejemplo:
>
> ```sql
> INSERT INTO comercio_marketplaces (comercio_id, marketplace_id, enabled)
> SELECT c.id, m.id, 1
> FROM comercios c
> JOIN marketplaces m ON m.name = '<Name>'
> WHERE NOT EXISTS (
>   SELECT 1 FROM comercio_marketplaces cm
>   WHERE cm.comercio_id = c.id AND cm.marketplace_id = m.id
> );
> ```

## 4. Cliente y fetcher (carpetas propias)

En `backend/src/modules/marketplaces/`:

- `clients/<name>-client/<name>-client.ts` — la envoltura HTTP para la API de la tienda
  (credenciales, timeouts, mapeo de errores, descarga de imágenes). Referencia:
  `clients/shopify-client/` (GraphQL) o `clients/prestashop-client/` (REST).
- `fetchers/<name>-fetcher/<name>-fetcher.ts` — convierte las respuestas de la API en
  `ProductData[]` respetando los filtros compartidos (`references`, `brand`,
  `description`, `images`, `filter_operator`, `limit`). Referencia:
  `fetchers/shopify-fetcher/`.

Estas carpetas no se registran en ningún sitio: el adaptador las importa directamente
porque son código dueño de la plataforma.

## 5. El adaptador

Crea `backend/src/modules/marketplaces/adapters/<name>-adapter.ts` exportando
`create<Name>Adapter(config, store, ctx)` e implementando todo el contrato
`MarketplaceAdapter`.

La resolución del cliente usa el hueco de fábrica inyectado, estrechado por el
adaptador dueño (el contrato lo mantiene opaco para que `app.ts` y el registro nunca
importen clases de cliente):

```ts
function ensureClient() {
  if (!client) {
    const factory = ctx.clientFactories?.<Name> as
      | ((config: <Name>Config) => <Name>Client)
      | undefined;
    client = factory ? factory(config) : new <Name>Client(config);
    fetcher = new <Name>Fetcher(client);
  }
  return { client, fetcher: fetcher! };
}
```

Reglas que siguen los adaptadores existentes:

- Persiste los productos leídos con `store.setDataset('<Name>', { dataId, fileId,
  fileName, products, totalRows })` y recógelos en `getDataset()` / `clearDataset()`.
- `fetch()` lanza `AppError('No products matched the given criteria', 404)` con
  resultado vacío — la forma de mensaje que espera el frontend.
- Traduce cada fallo visible con `translateMarketplaceError(error, label)`
  (`adapters/errors.ts`) para que el administrador vea el motivo específico con la
  etiqueta del marketplace, y conserva el `label` en los mensajes de conexión
  (`Conexión con ${label} correcta`).
- Guarda los éxitos/errores parciales como `{ successCount, failures[], results }` por
  producto.

Referencia más pequeña: `adapters/mock-adapter.ts` (sin configuración ni transporte).
Referencia completa: `adapters/shopify-adapter.ts`.

## 6. Regístralo (el único punto de despacho)

Añade una entrada al record `definitions` de
`backend/src/modules/marketplaces/adapters/registry.ts`:

```ts
<WooCommerce>: {
  name: '<Name>',
  slug: '<segmento-url-minusculas>',  // usado por /fetch/:marketplace y /config/test/:marketplace
  label: '<Etiqueta legible>',        // mensajes visibles para el usuario
  extractConfig: (config) => config.<name>,
  isConfigured: (config) => Boolean(config.<name>?.<campoRequerido1> && config.<name>?.<campoRequerido2>),
  buildTestConfig: (body, saved) => { /* arma el candidato; lanza AppError 400 si falta un campo requerido */ },
  create: (config, store, ctx) => create<Name>Adapter(config as <Name>Config, store, ctx)
}
```

Esa única entrada activa, **sin tocar ninguna ruta**:

- `POST /api/fetch/<slug>` · `GET /api/fetch/<slug>` · `DELETE /api/fetch/<slug>` ·
  `POST /api/fetch/<slug>/save`
- `POST /api/config/test/<slug>` (prueba de conexión)
- los slugs desconocidos ya responden `404 Marketplace desconocido`

Opcionalmente exporta la fábrica desde `adapters/index.ts` para que los tests la
importen desde el punto de entrada del paquete.

## 7. Cableado de backend que sigue siendo explícito

El flujo de fetch/prueba es genérico, pero el **cableado de configuración y sesión**
todavía nombra cada marketplace. Estos son los puntos que quedan:

- `backend/src/routes.ts` → `GET /config`: incluye la nueva sección en la respuesta y
  enmascara su secreto como las demás (`api_key`/`access_token` → `''` más
  `has_api_key`).
- `backend/src/routes.ts` → `PUT /config`:
  - conserva el secreto guardado si el cuerpo envía un placeholder vacío (mismo patrón
    que los bloques `body.prestashop` / `body.shopify`);
  - amplía la lista blanca de `active_marketplace` (actualmente
    `body.active_marketplace === 'PrestaShop' || body.active_marketplace === 'Shopify'`)
    — mejor: sustitúyela por una comprobación contra el registro
    (`definitions[body.active_marketplace]`) para no volver a tocar esa lista.
- `backend/src/modules/auth/routes.ts` → `GET /me`: añade el flag
  `<name>_configured` junto a `prestashop_configured` / `shopify_configured` (el
  frontend bloquea pantallas con él).
- `backend/src/modules/database-persistence/database-persistence.ts`: carga la sección
  con `findMarketplaceByName('<Name>', comercioId)` + `getMarketplaceConfig(...)` y
  guárdala con `setMarketplaceConfigBatch(...)` (replica los bloques
  `prestashop`/`shopify` en `load()` y `save()`).

## 8. Frontend

- `frontend/src/services/api-service.ts` — la capa de servicio todavía tiene un método
  por marketplace (`testPrestashopConnection`, `fetchShopifyData`,
  `savePrestashopEdits`…). Añade los nuevos métodos, o (recomendado, ya que las rutas
  del backend son por slug) generalízalos a `testConnection(slug, config)` /
  `fetchData(slug, request)` / `saveEdits(slug, updates)` y deja los nombres actuales
  como envolturas finas.
- `frontend/src/components/configuration/ConfigurationForm.tsx` — sección de
  credenciales (inputs + payload de guardado bajo la clave `<name>`) y el botón de
  prueba que llama a `POST /api/config/test/<slug>`.
- `frontend/src/components/data-upload/UploadSection.tsx` — sustituye la rama
  `activeMarketplace === 'Shopify'` por el slug/nombre del nuevo marketplace.
- `frontend/src/pages/products/ProductsViewPage.tsx` — ramas del flujo de guardado
  (etiqueta `saveTo<Name>` + `api.save<Name>Edits`).
- `frontend/src/pages/dashboard/DashboardPage.tsx` — puerta de "configura primero X"
  basada en el flag `<name>_configured`.
- `frontend/src/i18n.tsx` — añade las cadenas en **ambos** idiomas:
  `upload.<slug>*`, `config.<name>Section`, `config.test<Name>`, `config.<slug>Ok`,
  `view.saveTo<Name>`, `view.saved<Name>`, `view.savePartial<Name>`…

## 9. Tests

Backend (`backend/` + `test/` en la raíz):

- `test/marketplace-registry.test.ts` — parsing de slug, etiqueta, `isConfigured`,
  errores de validación de `buildTestConfig`.
- `test/<name>-adapter.test.ts` — lógica del adaptador con un cliente falso inyectado,
  sin HTTP:
  `create<Name>Adapter(config, store, { clientFactories: { <Name>: () => fake as never } })`
  (patrón: `test/shopify-adapter.test.ts`).
- `test/<name>-client.test.ts` / `test/<name>-fetcher.test.ts` — axios mockeado.
- `test/api-routes.test.ts` — extremo a extremo con
  `createApp({ clientFactories: { <Name>: () => fake } })` (patrón: su helper
  `makeApp`).

Frontend (`frontend/`): `services/api-service.test.ts`, `ConfigurationForm.test.tsx`,
`UploadSection.test.tsx` y los tests de páginas que afirman las ramas del marketplace.

## 10. Documentación, verificación y release

- Actualiza el árbol de módulos en `docs/ARCHITECTURE.md` / `docs/ARCHITECTURE_es.md`
  y las páginas de configuración si cambió la pantalla de ajustes; añade una entrada en
  `CHANGELOG.md`.
- Verificación (ejecútala desde las carpetas indicadas; PowerShell necesita
  `cmd /c "..."` para npx):
  - backend: `npx tsc --noEmit`, `npx jest --silent`
  - frontend: `npx tsc --noEmit`, `npx vitest run`
  - lint en ambos (`npm run lint`) y después `npm run build` desde la raíz del
    repositorio.
- Versión: edita **solo** el campo `version` del `package.json` raíz y ejecuta
  `npm run build` (el hook `prebuild` ejecuta `sync:version`); nunca edites a mano los
  demás `package.json` ni los tokens de versión de la documentación.

## Referencia: el marketplace Mock

`Mock` (slug `mock`, `adapters/mock-adapter.ts`) es un marketplace de pruebas para demos
y tests, y es el adaptador más pequeño posible. Se registra como cualquier otro, así que
`POST /api/fetch/mock` y `POST /api/config/test/mock` funcionan desde el primer
momento, pero **no aparece deliberadamente en la pantalla de configuración**:

- no tiene credenciales (`extractConfig: () => ({})`, `isConfigured: () => true`), así
  que no hay nada que configurar ni probar;
- `active_marketplace` solo acepta tiendas reales: `MarketplaceName` excluye `'Mock'`
  (véase el comentario en `adapters/types.ts`) y `PUT /config` admite únicamente los
  nombres concretos.

Cualquier marketplace que quiera aparecer en la pantalla de ajustes necesita por tanto
una sección en `CatalogConfig` (paso 2), su cableado de base de datos (pasos 3 y 7) y
una sección en `ConfigurationForm` (paso 8).

## Lista de comprobación

- [ ] `MarketplaceName` + `<Name>Config` en `backend/src/types.ts` y `frontend/src/types.ts`
- [ ] Sección en `CatalogConfig` + valores por defecto en `backend/src/store.ts`
- [ ] Entrada en `SEED_MARKETPLACES` + relleno para comercios existentes
- [ ] `marketplaces/clients/<name>-client/` y `marketplaces/fetchers/<name>-fetcher/`
- [ ] `marketplaces/adapters/<name>-adapter.ts` implementando `MarketplaceAdapter`
- [ ] Entrada en `definitions` de `marketplaces/adapters/registry.ts`
- [ ] Enmascaredo de `GET/PUT /config`, conservación de secretos y lista blanca de `active_marketplace`
- [ ] `<name>_configured` en `GET /me`
- [ ] `DatabasePersistence.load()/save()` para la nueva sección
- [ ] Frontend: api-service, ConfigurationForm, UploadSection, ProductsViewPage, DashboardPage, i18n (es + en)
- [ ] Tests de backend y frontend
- [ ] Docs, CHANGELOG, subida de versión, verificación completa
