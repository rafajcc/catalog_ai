# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- Bumped `nanoid` to `^3.3.18` to address a high-severity advisory (GHSA-2v37-7h3g-55p8). The app calls `nanoid(8)` with a fixed size, so it was not exposed, but the dependency is now patched. In the frontend, `postcss` pulls `nanoid@3.3.17`, so an `overrides` entry forces `3.3.18` for the whole tree (`npm audit` now reports 0 vulnerabilities project-wide).

## [1.2.0] - 2026-08-27

### Added
- **`.env.example` moved to the project root** as the single reference, with `JWT_REFRESH_SECRET` and `DATA_DIR`; removed the obsolete `CONFIG_SECRET`/`CONFIG_FILE` variables.

### Changed
- **Removed dead code** from the migration to SQLite storage:
  - Deleted the legacy file-based AES-encrypted config module (`config-persistence.ts`) and its test suite (`config-persistence.test.ts`) plus the `test:config-persistence` npm script.
  - Removed unused imports (`DataStore`, `ConfigPersistence`, `normalizeAIConfig`, `DatabasePersistence`, `listComercios`, `AIProviderName`) and the unused `listComercios` export + its re-export.
  - Cleaned `.gitignore` (`config.json` / `config.json.key` no longer generated).
- **Documentation** updated (CONFIGURATION, INSTALLATION, ARCHITECTURE, TESTING — English and Spanish) to reflect SQLite storage: removed outdated AES-256-GCM / `CONFIG_SECRET` / `config.json.key` / auto-generated `jwt.key` references and corrected the database location.
- Moved the env template from `backend/` to the project root.

### Fixed
- **Dashboard toggle handlers**: the "discard changes" confirmation now respects the Cancel button — closing the config/users panel only happens when the user actually confirms the dialog (previously the state change ran regardless of the confirm result).

## [1.1.0] - 2026-08-27

### Added
- **Single-process production deployment**: the backend now serves the frontend static files (from `backend/public/`) with an SPA fallback, so the app runs as one Node.js process on one port. CORS is disabled in production (same-origin).
- **Root `package.json`** with convenience scripts: `build`, `start`, `test`, `lint`, `build:backend`, `build:frontend`. `npm run build` builds the frontend, copies it into `backend/public/` via `copy-dist.js`, then compiles the backend.
- **`copy-dist.js`**: cross-platform Node script that copies `frontend/dist/*` into `backend/public/`.
- **Separate build tsconfig** (`frontend/tsconfig.build.json`): the production build excludes test files, so `tsc` no longer fails on Vitest/jest-dom test typings.
- **App version `v1.1.0`** displayed in the app header and returned by `GET /api/status`.

### Changed
- Production no longer requires a reverse proxy or two separate processes — a single Node.js process serves both the API (`/api/*`) and the React frontend.
- Documentation updated (README, INSTALLATION, DEPLOYMENT, ARCHITECTURE, CONFIGURATION, API, TESTING — English and Spanish) to reflect the single-process deployment, up-to-date build/run commands, Vitest-based frontend tests, and the idempotent database schema (no more delete-on-restart).
- Removed leftover Jest config files from the frontend (`jest.config.cjs`, `jest.setup.ts`, `jest.styleMock.cjs`) after the migration to Vitest.
- `.gitignore` now ignores `backend/public/` and no longer lists duplicate config entries.

### Fixed
- Frontend production build no longer fails typecheck on test files (fixed via `tsconfig.build.json` excluding tests).
- Backend test for unknown routes updated: non-API routes now return the SPA fallback (200) when a build exists, while unknown `/api/*` routes return 404.

## [1.0.0] - 2026-08-24

### Added

#### Authentication & Multi-tenancy
- **Multi-tenant authentication system**: each "comercio" (business/shop) has its own isolated set of users, marketplace configs, AI provider configs and prompts. All configuration tables are scoped by `comercio_id` foreign key.
- **User registration flow**: a "Registrar nuevo comercio" link on the login page opens a form to create a new business with its first admin user. The endpoint `POST /api/auth/register-comercio` creates the comercio, seeds its default marketplaces and AI providers, creates the admin user and returns a success message (no auto-login).
- **Login page**: users sign in with username and password only; the comercio is derived from the user's record (users belong to exactly one comercio). Failed login attempts trigger account lockout after 5 attempts within 15 minutes.
- **JWT authentication**: access and refresh tokens issued as httpOnly cookies. `TokenPayload` carries `sub`, `username`, `role`, `comercio_id`. Roles are `admin` (full access) and `user` (read-only config). Endpoints `PUT /api/config`, user management and config reset require admin role.
- **User management page**: admin-only CRUD interface for creating, editing and deleting users within the comercio.
- **Role-based configuration access**: `user` role sees the Configuration panel in read-only mode; `admin` can edit all settings. Backend validates with 403 for forbidden fields.
- **Per-request config loading**: the `loadComercioConfig` middleware creates a fresh `DataStore` per authenticated request, loading the comercio's configuration from the database via `DatabasePersistence(comercioId)`. Data never leaks between tenants.
- **`DataStore` reuse per comercio**: `loadComercioConfig` maintains a `Map<number, DataStore>` so that PrestaShop dataset fetched during AI autocomplete persists across requests within the same session.

#### Database
- **SQLite multi-tenant database**: schema includes `comercios`, `users`, `login_attempts`, `marketplaces`, `ai_providers`, `comercio_marketplaces`, `comercio_ai_providers`, `marketplace_config`, `ai_provider_config` and `app_settings` tables. Global `marketplaces` and `ai_providers` tables (no `comercio_id`) with junction tables for per-comercio enablement. Persists to `catalogai.db` via sql.js (pure WASM, zero native deps).
- **Database schema v3**: normalized schema with global marketplace/provider definitions and junction tables, proper FK with integer IDs. All slugs removed — every lookup uses integer `id`.
- **Idempotent schema initialization**: all tables created with `CREATE TABLE IF NOT EXISTS` + `INSERT OR IGNORE` — database is never deleted or recreated on restart.

#### PrestaShop Integration
- **PrestaShop import in the dashboard**: `POST /api/fetch/prestashop` downloads products straight from the store via the Webservice, filtered by reference, brand, description presence and image presence (combined with AND or OR logic), importing the first 50 matching products. Products with combinations are imported as one row per combination (combination-level price, wholesale price and stock; product-level name, descriptions, brand, category and tax), and products without combinations as a single product-level row.
- **Brand filter in the PrestaShop import**: a free-text "brand" field is resolved to PrestaShop manufacturer ids (case-insensitive partial match) and narrows the pool at source; an empty brand imports every brand. `DELETE /api/fetch/prestashop` discards the fetched dataset.
- **PrestaShop image upload**: `uploadProductImage()` on the backend sends product images to PrestaShop via multipart POST using `form.getBuffer()` with explicit `Content-Type` header. Supports both AI-added image URLs and locally uploaded image files.
- **PrestaShop image deletion**: `DELETE /fetch/prestashop/images/:productId/:imageId` endpoint removes images from PrestaShop. Backend `deleteProductImage()` method on the PrestaShop client.
- **Test connection uses saved API key**: when frontend sends empty `api_key` in test connection, backend falls back to `saved?.api_key` from stored config. Error messages translated to Spanish via `translatePrestashopError()`.
- **Human-readable PrestaShop error messages**: `translatePrestashopError(error, marketplace)` translates raw HTTP/network errors into Spanish.

#### AI Features
- **AI autocomplete for imported products**: real-time autocomplete for products with empty fields or fewer than 5 images, shown as errors as they happen during the sequential product loop, accumulating a list of `{reference, message}` pairs displayed in a scrollable error panel.
- **AI image search**: up to 5 product image URLs returned via web search, proxied through backend image proxy endpoint. `imagesNeeded` calculated server-side per product (5 minus current count).
- **AI image format restriction**: prompts (ES/EN) and autocomplete instructions explicitly restrict image URLs to JPG/JPEG/PNG only, rejecting SVG/WEBP/GIF/BMP/TIFF.
- **AI provider selector in Products view**: dropdown shows only providers with saved configuration. Default provider labeled "(por defecto)". Backend `/autocomplete` accepts optional `provider` parameter.
- **AI test connection message**: only shows under the tested provider, not all sections. Error messages translated to Spanish via `translateAIError()`.
- **AI `buildAIConfig` fix**: empty string values from request body no longer override stored per-provider settings.
- **Default prompt restore**: `POST /api/config/reset-prompt` deletes the custom prompt and reverts to the system default.
- **Default prompts**: include "BÚSQUEDA WEB OBLIGATORIA" + "BÚSQUEDA DE IMÁGENES" instructions for AI providers.

#### Product Management
- **Imported products view**: grid with meta fields and image lightbox; products shown with brand, category, price, stock and images.
- **Product selection checkboxes**: per-product checkboxes + "Select All" in toolbar. All selected by default. Only selected products sent to AI autocomplete and PrestaShop save. Selection persists across navigation.
- **`needsAiProcessing` filter**: products are included in AI autocomplete if selected AND (has empty text fields OR has fewer than 5 images).
- **Local image upload in edit modal**: file picker button (+) in the Images section of the product edit modal allows uploading local image files. Images stored as `ProductImageUpload` (base64 data + content_type).
- **Image deletion in edit modal**: delete button (×) on each image thumbnail removes images from the product. Deletions tracked in `images_to_delete` array and sent to backend during save.
- **5-image maximum limit**: add button hidden and "Máximo 5 imágenes" hint shown when existing + local images reach 5.
- **Images edited indicator**: blue label with asterisk on "Imágenes" when image changes exist in edits.
- **Image state unified into edits**: AI image URLs stored in `edits[productId].image_urls` (same object as text edits). `mergeProductEdits` converts them to proxied `PrestaShopProductImage[]` for display.
- **Save flow with image processing**: backend save endpoint processes `images_to_delete` (deletions before uploads), then uploads local images and AI URLs to PrestaShop. Per-product `imageFailCount` tracking — product marked as failed only if all images fail.
- **Per-product save results**: success/failure shown individually per product after saving to PrestaShop.
- **Edited indicator on deselected products**: only saved products' edits removed from pending state (not all edits).

#### Configuration Panel
- **Configuration panel with collapsible sections**: PrestaShop settings (base URL, API key, version `1.7`/`8`/`9`, language id) and AI provider settings (provider, model, language, API key, base URL), with connection tests for both.
- **Configuration persistence in SQLite database**: per comercio via `DatabasePersistence` class. Configuration and Users panels are mutually exclusive.
- **Configuration toolbar**: Save/Back buttons in fixed toolbar header. Toolbar is non-scrolling, content below scrolls.
- **Unsaved changes warning**: `ConfigurationForm` tracks dirty state via `computeDirty()`. Dashboard warns before Home/Users navigation when changes are pending.
- **Config section visual differentiation**: Marketplaces section has slate-gray border (`#94a3b8`), AI providers section has indigo border (`#6366f1`), default provider subsection has emerald border (`#34d399`) with "Activo" badge.
- **Default provider label**: "Proveedor por defecto" (ES) / "Default provider" (EN).
- **API key masking**: `GET /api/config` returns `api_key: ""` with `has_api_key: boolean` so the frontend never sees real keys. `PUT /api/config` preserves existing keys when an empty string is sent. Frontend shows `••••••••` placeholder + blue "Guardado" badge when key exists.
- **Browser autocomplete disabled**: all `<input>` and `<textarea>` elements have `autoComplete="off"` except LoginPage fields.

#### Internationalization & Branding
- **Full internationalization** (Spanish by default, English selectable) via an `I18nProvider`/`useI18n` hook with a language toggle in the header and `localStorage` persistence.
- **Vera Technology branding**: login/register show `VERA-LOGO.svg` (60px height, 0.5 opacity). Header shows `VERA-LOGO-icon_only.png` (20px, 0.7 opacity). HTML title: "Catálogo IA - Vera Technology". Favicon: `VERA-LOGO-icon_only.png`.
- **App name localized**: "Catálogo IA" (ES) / "Catalog AI" (EN) via i18n key `'app.name'`.
- **Comercio name + username in header**: header shows `username · comercioName`.
- **App header layout**: icon + app name + version | username · comercioName | Estado (status chip) | language toggle | settings | users | logout. Settings and logout buttons only visible when authenticated.

#### Frontend Infrastructure
- **State-based routing in `App.tsx`**: login → register → dashboard, with session check via `GET /api/auth/me` on startup.
- **Backend health indicator**: dashboard polls `GET /api/status` (with automatic recovery) and reports online/offline/degraded states.
- **`POST /api/status` returns version**: endpoint includes `version` field from `package.json`.
- **Logout button** in the app header logs the user out and returns to the login page.
- **Admin redirect to Config**: backend `/me` returns `prestashop_configured: boolean`. Dashboard auto-opens Configuration for admin when `!prestashopConfigured`.
- **`DataStore` reuse per comercio**: PrestaShop dataset persists across requests within the same session.
- **Flex layout for Config and Products views**: root div + `<main>` use `flex column; height: 100vh; overflow: hidden`.
- **Registration flow**: no auto-login on register. Shows "Comercio registrado correctamente" success message + "Ir al inicio de sesión" button.
- **Login page**: app header shows app name + language selector only; status, settings and logout buttons are only visible when authenticated.

#### Backend Logging
- **Enhanced PrestaShop API logging**: request interceptor logs method, URL, contentType, accept (auth NOT logged). Response interceptor logs body preview (2000 chars). Error interceptor logs response body/status/url for all error statuses.

#### Infrastructure
- **`ProductImageUpload` type**: `{ data: string; content_type: string }` — used in both frontend and backend types.
- **`fetchImageAsBase64` helper** in ProductsViewPage: fetches via proxy endpoint with auth token, converts response to base64.
- **Proxy-only image storage**: no disk storage. Images fetched live from external URLs through backend proxy.
- **BSL 1.1 license**: Business Source License 1.1. Copyright: Vera Technology; rafajcc. Change Date: 2030-08-21. Change License: Apache 2.0.

#### Testing & Documentation
- **Backend test suite**: Express app, API routes, PrestaShop client and fetcher, error handling and logging (supertest, mocked axios).
- **Frontend test suite**: Vitest + React Testing Library — 137 tests across 12 files covering API service, hooks, layout, configuration form, data upload, PrestaShop import panel, user management, products view, dashboard flow, and app component.
- **Documentation in Spanish**: README and documentation files translated to Spanish.
- **Documentation restructured**: README reorganized with detailed sections in `docs/` directory.

### Changed
- Configuration is now persisted in the SQLite database (per comercio) instead of a local JSON file. The `DatabasePersistence` class replaces `ConfigPersistence` for DB-backed load/save scoped by `comercioId`.
- `index.ts` no longer creates a default comercio or admin user on startup. The first-run experience is the registration flow from the login page.
- `POST /api/auth/login` only accepts `{ username, password }` — the `comercio_slug` field is no longer required. The backend finds the user across all comercios and derives the comercio from the user's `comercio_id`.
- `GET /api/auth/comercios` endpoint removed (no longer needed for login).
- `AppHeader` component props `status`, `onToggleConfiguration` and `onLogout` are now optional; when omitted the corresponding UI elements are not rendered.
- `CollapsibleSection` headers are now clickable (role="button", keyboard navigation, aria-expanded, cursor:pointer, hover/focus-visible styles).
- Typography hierarchy in configuration panel: h2 (1.3rem/700), section h3 (1.1rem/600), subsection h3 (0.9rem/500/gray).
- `DashboardPage` no longer auto-fetches PrestaShop data on mount (each comercio has its own connection; data is fetched on demand).
- `AIProviderSettings` interface now includes `temperature` field.
- `PATCH` used for PrestaShop 8/9 updates; `PUT` for 1.7 (with read-only fields stripped).
- Mock images: 5 PNG files (`test-product-image.png` through `test-product-image-5.png`) — 200x100px colored backgrounds with white text "Mock 1" through "Mock 5". Generated with pure Node.js (zlib) using a pixel font.
- AI provider seed names are lowercase (`mock`, `openai`, `anthropic`, `openrouter`, `gpt4all`) matching `AIProviderName` type exactly.
- Marketplace seed: `PrestaShop` (capital P, capital S).

### Fixed
- `DatabasePersistence.load()` always returns an object even when no config exists for a comercio.
- `createComercio` seed logic corrected to use subquery for `last_insert_rowid()`.
- `enabled_fields` type in `DatabasePersistence` now correctly typed as `AIContentField[]`.
- Backend route handlers all use `req.store` (per-request) instead of module-level `store`.
- `requireAuth` middleware test mock sets `req.user` properly.
- PrestaShop `config.headers.forEach()` removed from interceptor — was causing connection test failures.
- PrestaShop image upload `Content-Type` conflict: now uses `form.getBuffer()` with explicit `Content-Type` header.
- Image state persistence: AI-added images and local uploads survive navigation.
- Edited indicator visibility: only saved products' edits cleared from pending state after save, not all edits.
- `mock` uses `imagesNeeded` from request instead of calculating it. Returns all 5 images; frontend caps via `imagesNeeded` from backend prompt.

## [0.1.0] - 2026-08-11

### Added
- Initial Catalog AI release: a full-stack application (Express + React) that imports PrestaShop product catalogs through the Webservice API.
- PrestaShop import in the dashboard: `POST /api/fetch/prestashop` downloads products straight from the store via the Webservice, filtered by reference, brand, description presence and image presence (combined with AND or OR logic), importing the first 50 matching products. Products with combinations are imported as one row per combination (combination-level price, wholesale price and stock; product-level name, descriptions, brand, category and tax), and products without combinations as a single product-level row.
- Brand filter in the PrestaShop import: a free-text "brand" field is resolved to PrestaShop manufacturer ids (case-insensitive partial match) and narrows the pool at source; an empty brand imports every brand. `DELETE /api/fetch/prestashop` discards the fetched dataset.
- Configuration panel: PrestaShop settings (base URL, API key, version `1.7`/`8`/`9`, language id) and AI provider settings (provider, model, language, API key), with connection tests for both (PrestaShop webservice root check; AI via a mock provider that needs no API key).
- Configuration persistence to a local JSON file with the API keys encrypted at rest (AES-256-GCM): the encryption key comes from the `CONFIG_SECRET` environment variable or a generated `config.json.key` file, and the location is overridable with `CONFIG_FILE`.
- Backend health indicator in the header: the dashboard polls `GET /api/status` (with automatic recovery) and reports online/offline/degraded states.
- Full internationalization (Spanish by default, English selectable) via an `I18nProvider`/`useI18n` hook with a language toggle in the header and `localStorage` persistence.
- Backend test suite: Express app, API routes, PrestaShop client and fetcher, config persistence, error handling and logging (supertest, mocked axios).
- Frontend test suite: API service, hooks, layout, configuration form, PrestaShop import panel and dashboard flow (vitest + RTL).
- BSL 1.1 `LICENSE` and this changelog referenced from the README.

[Unreleased]: https://github.com/rafajcc/catalog_ai
[1.2.0]: https://github.com/rafajcc/catalog_ai/releases/tag/v1.2.0
[1.1.0]: https://github.com/rafajcc/catalog_ai/releases/tag/v1.1.0
[1.0.0]: https://github.com/rafajcc/catalog_ai/releases/tag/v1.0.0
[0.1.0]: https://github.com/rafajcc/catalog_ai/releases/tag/v0.1.0
