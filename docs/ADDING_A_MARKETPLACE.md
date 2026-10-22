# Adding a marketplace

Step-by-step guide for adding a new marketplace to Catalog AI.

Since the adapter refactor, the core never imports a concrete marketplace: `routes.ts`
only sees the `MarketplaceAdapter` contract and resolves implementations through the
registry. This guide lists every file that changes, in order, plus the tests that prove
it works.

## How the layer fits together

```
routes.ts / app.ts (composition root)
        │  resolveMarketplace(name, config, store, ctx)   ← injected, never built inline
        ▼
adapters/registry.ts  ── definitions[name]  (the ONLY place that branches per marketplace)
        ▼
adapters/<name>-adapter.ts  ── implements MarketplaceAdapter
        │
        ├── clients/<name>-client/     HTTP transport (platform-owned code)
        └── fetchers/<name>-fetcher/   filters → ProductData[] (platform-owned code)
```

Two contracts, both in `backend/src/modules/marketplaces/adapters/`:

- **`types.ts` → `MarketplaceAdapter`** — `name`, `testConnection()`, `fetch(filters)`,
  `getDataset()`, `clearDataset()`, `saveUpdates(updates)`, `proxyImage()`,
  `deleteImage()`. This is all the core ever calls.
- **`registry.ts` → `MarketplaceCreateContext`** — test-only injection:
  `clientFactories` is a `Partial<Record<RegisteredMarketplace, config => unknown>>`, so
  the contract never names a concrete client class. In production it stays `undefined`
  and the adapter builds its own real client.

## 1. Name and config type

- `backend/src/types.ts` — extend the union
  `type MarketplaceName = 'PrestaShop' | 'Shopify'` with the new name (e.g.
  `'WooCommerce'`), and add a `<Name>Config` interface next to `PrestaShopConfig` /
  `ShopifyConfig` with the credentials the shop needs.
- `frontend/src/types.ts` — mirror the same `MarketplaceName` union (and the config
  interface) on the client.

`RegisteredMarketplace = MarketplaceName` picks the new name up automatically, so the
registry, slug parsing and routes accept it with no further edits.

## 2. CatalogConfig section

`backend/src/store.ts`:

- Add `<name>: <Name>Config` to the `CatalogConfig` interface (both configs are kept so
  the settings screen can show and test either marketplace at any time).
- Add the empty defaults in `defaultConfig()`.

## 3. Database seed and per-comercio enablement

`backend/src/modules/auth/database.ts`:

- Add `{ name: '<Name>' }` to `SEED_MARKETPLACES`. The row is inserted idempotently
  (`INSERT OR IGNORE`) at boot on both the SQLite and the MySQL/MariaDB paths. The
  row carries the platform-wide `enabled` switch (default `1`), which the super
  admin toggles from the **Marketplaces** tab; a new marketplace therefore starts
  visible for every comercio.
- The `marketplace_config` table is key/value per `marketplace_id`, so the new
  credential fields need **no schema change**.

> **Warning — existing comercios.** `createComercio()` enables every seeded marketplace
> only for *new* comercios. `findMarketplaceByName()` joins `comercio_marketplaces`, so
> a comercio created before this change has no row for the new marketplace and
> `DatabasePersistence.load()/save()` silently skip its section. Add an idempotent
> backfill at boot (and test it), for example:
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

## 4. Client and fetcher (own folders)

Under `backend/src/modules/marketplaces/`:

- `clients/<name>-client/<name>-client.ts` — the HTTP wrapper for the shop's API
  (credentials, timeouts, error mapping, image download). Reference:
  `clients/shopify-client/` (GraphQL) or `clients/prestashop-client/` (REST).
- `fetchers/<name>-fetcher/<name>-fetcher.ts` — turns raw API responses into
  `ProductData[]`, honouring the shared filters (`references`, `brand`, `description`,
  `images`, `filter_operator`, `limit`). Reference: `fetchers/shopify-fetcher/`.

Nothing registers these folders: the adapter imports them directly, because they are
platform-owned code.

## 5. The adapter

Create `backend/src/modules/marketplaces/adapters/<name>-adapter.ts` exporting
`create<Name>Adapter(config, store, ctx)` and implementing the whole
`MarketplaceAdapter` contract.

Client resolution uses the injected factory slot, narrowed by the owning adapter (the
contract keeps it opaque so `app.ts` and the registry never import client classes):

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

Rules the existing adapters follow:

- Persist fetched products with `store.setDataset('<Name>', { dataId, fileId, fileName,
  products, totalRows })` and read them back in `getDataset()` / `clearDataset()`.
- `fetch()` throws `AppError('No products matched the given criteria', 404)` on an
  empty result — the message shape the frontend expects.
- Translate every user-facing failure through `translateMarketplaceError(error, label)`
  (`adapters/errors.ts`) so the admin sees the specific reason with the marketplace
  label, and keep the `label` in connection messages (`Conexión con ${label} correcta`).
- Save partial failures as `{ successCount, failures[], results }` per product.

Simplest possible reference: `adapters/mock-adapter.ts` (no config, no transport).
Full reference: `adapters/shopify-adapter.ts`.

## 6. Register it (the only dispatch point)

Add one entry to the `definitions` record in
`backend/src/modules/marketplaces/adapters/registry.ts`:

```ts
<WooCommerce>: {
  name: '<Name>',
  slug: '<lowercase-url-segment>',   // used by /fetch/:marketplace and /config/test/:marketplace
  label: '<Human label>',            // user-facing messages
  extractConfig: (config) => config.<name>,
  isConfigured: (config) => Boolean(config.<name>?.<requiredField1> && config.<name>?.<requiredField2>),
  buildTestConfig: (body, saved) => { /* assemble candidate, throw AppError 400 if a required field is empty */ },
  create: (config, store, ctx) => create<Name>Adapter(config as <Name>Config, store, ctx)
}
```

That single entry switches on, with **zero route changes**:

- `POST /api/fetch/<slug>` · `GET /api/fetch/<slug>` · `DELETE /api/fetch/<slug>` ·
  `POST /api/fetch/<slug>/save`
- `POST /api/config/test/<slug>` (connection test)
- unknown slugs already answer `404 Marketplace desconocido`

Optionally export the factory from `adapters/index.ts` so tests can import it from the
package entry point.

## 7. Backend plumbing that is still explicit

The fetch/test flow is fully generic, but the **configuration/session plumbing** still
names each marketplace. These are the remaining touch points:

- `backend/src/routes.ts` → `GET /config`: include the new section in the response and
  mask its secret like the others (`api_key`/`access_token` → `''` plus `has_api_key`).
- `backend/src/routes.ts` → `PUT /config`:
  - preserve the stored secret when the body sends an empty placeholder (same pattern
    as the `body.prestashop` / `body.shopify` blocks);
  - extend the `active_marketplace` whitelist (currently
    `body.active_marketplace === 'PrestaShop' || body.active_marketplace === 'Shopify'`)
    — better: replace it with a registry check (`definitions[body.active_marketplace]`)
    so this list never has to be edited again.
- `backend/src/modules/auth/routes.ts` → `GET /me`: add the `<name>_configured` flag
  next to `prestashop_configured` / `shopify_configured` (the frontend gates screens
  on it).
- `backend/src/modules/database-persistence/database-persistence.ts`: load the section
  with `findMarketplaceByName('<Name>', comercioId)` + `getMarketplaceConfig(...)` and
  save it with `setMarketplaceConfigBatch(...)` (mirror the `prestashop`/`shopify`
  blocks in `load()` and `save()`).

## 8. Frontend

- `frontend/src/services/api-service.ts` — the service layer still has one method per
  marketplace (`testPrestashopConnection`, `fetchShopifyData`, `savePrestashopEdits`…).
  Add the new methods, or (recommended, now that the backend routes are slug-based)
  generalize them to `testConnection(slug, config)` / `fetchData(slug, request)` /
  `saveEdits(slug, updates)` and keep the old names as thin wrappers.
- `frontend/src/components/configuration/ConfigurationForm.tsx` — credential section
  (inputs + save payload under the `<name>` key) and the test button that calls
  `POST /api/config/test/<slug>`.
- `frontend/src/components/data-upload/UploadSection.tsx` — replaces the
  `activeMarketplace === 'Shopify'` branch with the slug/name of the new marketplace.
- `frontend/src/pages/products/ProductsViewPage.tsx` — save flow branching
  (`saveTo<Name>` label + `api.save<Name>Edits`).
- `frontend/src/pages/dashboard/DashboardPage.tsx` — "configure X first" gate based on
  the `<name>_configured` flag.
- `frontend/src/i18n.tsx` — add the strings in **both** languages: `upload.<slug>*`,
  `config.<name>Section`, `config.test<Name>`, `config.<slug>Ok`, `view.saveTo<Name>`,
  `view.saved<Name>`, `view.savePartial<Name>`…

## 9. Tests

Backend (`backend/` + root `test/`):

- `test/marketplace-registry.test.ts` — slug parsing, label, `isConfigured`,
  `buildTestConfig` validation errors.
- `test/<name>-adapter.test.ts` — adapter logic with an injected fake client, no HTTP:
  `create<Name>Adapter(config, store, { clientFactories: { <Name>: () => fake as never } })`
  (pattern: `test/shopify-adapter.test.ts`).
- `test/<name>-client.test.ts` / `test/<name>-fetcher.test.ts` — axios mocked.
- `test/api-routes.test.ts` — end-to-end through
  `createApp({ clientFactories: { <Name>: () => fake } })` (pattern: its `makeApp`
  helper).

Frontend (`frontend/`): `services/api-service.test.ts`, `ConfigurationForm.test.tsx`,
`UploadSection.test.tsx` and the page tests that assert the marketplace branches.

## 10. Docs, verification and release

- Update the module tree in `docs/ARCHITECTURE.md` / `docs/ARCHITECTURE_es.md` and the
  configuration pages if the settings screen changed; add a `CHANGELOG.md` entry.
- Verification (run from the folders shown; PowerShell needs `cmd /c "..."` for npx):
  - backend: `npx tsc --noEmit`, `npx jest --silent`
  - frontend: `npx tsc --noEmit`, `npx vitest run`
  - lint both (`npm run lint`), then `npm run build` from the repository root.
- Version: edit **only** the root `package.json` `version` field and run
  `npm run build` (the `prebuild` hook runs `sync:version`); never edit the other
  `package.json` files or the docs version tokens by hand.

## Reference: the Mock marketplace

`Mock` (slug `mock`, `adapters/mock-adapter.ts`) is a canned marketplace for demos and
tests and is the smallest possible adapter. It is registered like any other, so
`POST /api/fetch/mock` and `POST /api/config/test/mock` work out of the box. Since it
needs no credentials, it is also **selectable as the default marketplace**:

- it has no credentials (`extractConfig: () => ({})`, `isConfigured: () => true`), so
  there is nothing to configure or test and no section in `GET/PUT /config`;
- it appears as the **Mock** option of the default-marketplace dropdown, and
  `PUT /config` accepts it through `isRegisteredMarketplace()` — the registry, not a
  hardcoded list, decides what is valid (unknown names are ignored);
- the frontend treats it as always configured: `DashboardPage` skips the
  "configure your shop" gate, `UploadSection` uses the `upload.mock*` keys and the
  `fetchMockData` / `clearMockData` methods, and `ProductsViewPage` saves through
  `saveMockEdits` keyed by the product's own id (there is no external shop id).

Any real marketplace that should appear in the settings screen therefore needs a
`CatalogConfig` section (step 2), its database plumbing (steps 3 and 7) and a section
in `ConfigurationForm` (step 8); the Mock only needs its `MarketplaceName` entry, its
adapter and its registry definition.

## Checklist

- [ ] `MarketplaceName` + `<Name>Config` in `backend/src/types.ts` and `frontend/src/types.ts`
- [ ] `CatalogConfig` section + defaults in `backend/src/store.ts`
- [ ] `SEED_MARKETPLACES` entry + backfill for existing comercios
- [ ] `marketplaces/clients/<name>-client/` and `marketplaces/fetchers/<name>-fetcher/`
- [ ] `marketplaces/adapters/<name>-adapter.ts` implementing `MarketplaceAdapter`
- [ ] `definitions` entry in `marketplaces/adapters/registry.ts`
- [ ] `GET/PUT /config` masking, secret preservation and `active_marketplace` whitelist
- [ ] `<name>_configured` in `GET /me`
- [ ] `DatabasePersistence.load()/save()` for the new section
- [ ] Frontend: api-service, ConfigurationForm, UploadSection, ProductsViewPage, DashboardPage, i18n (es + en)
- [ ] Backend + frontend tests
- [ ] Docs, CHANGELOG, version bump, full verification
