# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Registration nonces (frontend complete).** The register form now has a required "invitation code" field sent to `POST /api/auth/register-comercio`, and the super admin panel gets a new "Invitation codes" tab to mint single-use codes (chosen 12h/24h/3d/7d expiry, code generated server-side), list them with their status (available/used/expired/blocked) and block a leaked code instantly. Previously the backend required the nonce but the UI could not produce one, making self-registration impossible.
- **MySQL/MariaDB persistence layer (implemented).** The database layer designed in the earlier "Database layer design" entry is now implemented: `DB_TYPE` is the **only and mandatory** engine selector — `sqlite` (embedded file) or `mysql|mariadb` (external, requires the `DB_*` group; without `DB_TYPE` the app refuses to boot). The domain layer keeps its exact synchronous API — the async `mysql2/promise` client lives in a `worker_thread` reached through a `MessageChannel` port + `SharedArrayBuffer`/`Atomics.wait`. See `docs/DATABASE.md` for the translation table and the opt-in `MYSQL_TEST_URL` integration test.

### Added
- **Image provider services.** Product images no longer come from the AI: a set of pluggable services (21 external providers + the local feeds table + the mock service) supplies them, configured by the super admin and shared by every comercio. Each service is its own small class in `modules/image-providers/providers/*` (registered once in the registry); the engine (`services/engine.ts`) runs them with feeds-first lookup, round-robin order, billing-cycle counters (`calls_this_cycle`, `cycle_start`, `billing_cycle_day`), a monthly call limit and URL validation. The seed activates the mock provider; the two listed-but-unsupported crawler services (Scraper + ScraperJS) stay disabled.
- **Super admin image-provider panel.** A new tab in the super admin panel lists the 23 services with their credentials/cycle state, lets the admin: reorder them by drag & drop (round-robin order), enable/disable, fill or clear credentials through a modal (stored keys are never exposed, only `has_*` flags), set the monthly call limit and the billing cycle day (changing the day resets the counters), reset the counters manually, and manage the local feeds table (brand/reference/EAN → image URL, with search).
- **Provider feeds table.** Super admins can upload product images per `brand (+ reference + EAN)` in `provider_feed_images`; the engine looks the product up first (brand+reference+ean, then brand+reference, then brand+ean) when the `feeds` service is enabled, before any external provider.
- **Feed images moved to their own tab.** The super admin feeds manager used to be rendered at the bottom of the image-providers tab; it now lives in a dedicated "Feed images" tab so the provider list stays focused.
- **Feeds pinned first in the provider list.** The provider table always shows the `feeds` service on top and its row cannot be dragged or have anything dropped above it, matching the engine's runtime behaviour (feeds is always queried first when enabled). A small note under its name explains it: "When enabled, it will always be the first service used".
- **Single Decodo service.** Decodo had two almost identical entries (`decodo_standard` and `decodo_premium`) that only switched the `proxy_pool` field. The GetImages proof of concept never sends `proxy_pool` (the API defaults to the premium pool), so `decodo_standard` is removed and the remaining service (slug `decodo_premium`, name "Decodo") is now aligned with the POC: `target: 'google'`, `headless: 'html'`, `parse: true`, `page_count: 1`, image URLs collected by walking the parsed JSON, and automatic retries on HTTP 429.
- **AI providers refactored into per-service classes.** The AI providers now mirror the image-provider architecture: each service (`openai`, `anthropic`, `openrouter`, `mock`) has its own class under `modules/ai-providers/providers/*`, a shared abstract base, and a registry that maps the provider id to its class. The suggester resolves the provider through `createAIProvider(config)` instead of an internal switch — adding or replacing a provider is a matter of registering a new class.
- **Database layer design.** Added `docs/DATABASE.md` (+ `DATABASE_es.md`) specifying a pluggable persistence layer: a `DatabaseAdapter` port (`run`/`queryAll`/`queryOne`/`exec`/`persist`) with three adapters — `SqliteAdapter` (current sql.js behaviour, default), `PgAdapter` and `MysqlAdapter`. The backend is selected with `DB_TYPE=sqlite|postgres|mysql` plus the `DB_*` variables (`DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_SSL`, `DB_MAX_POOL`); the design covers the async flip of `database.ts`, dialect translation (`?`→`$n`, `INSERT OR IGNORE`, `ON CONFLICT`, `datetime('now')`, `last_insert_rowid()`), the rollout plan and a shared adapter contract test. No code changes yet.
- **App version bumped to 1.2.2.** The header now shows the version reported by `GET /api/status` (backed by `package.json`) next to the app name instead of a hardcoded stale string, so the badge always matches the deployed build.
- **Platform super admin.** An optional `ADMIN_USER` + `ADMIN_PASSWORD` (bcrypt hash) in the environment creates a super admin account that is not part of the database. The super admin logs in from the login page and gets a dedicated panel to: activate/deactivate any registered comercio (a deactivated comercio blocks new logins and already-open sessions), list the users of any comercio, and reset any password — including those of other admins. Because the credentials are read from the environment on every request, removing the variables also invalidates open super admin sessions.
- **Forced password change on first login.** Users created from the Users panel or whose password was reset by an admin/super admin must change it before using the platform: the backend rejects every endpoint except `/auth/me`, `/auth/change-password` and `/auth/logout` while the change is pending, and the frontend shows a dedicated "change password" screen right after login. The required password-change badge is visible in the user lists.
- **User enable/disable (schema v6).** Users gain an `active` column (default 1). The admin `PUT /api/auth/users/:id` accepts `active`, and a new super-admin endpoint `PUT /api/auth/superadmin/comercios/:id/users/:userId/active` toggles it platform-wide. A disabled user cannot log in or refresh and its open sessions are killed on the next request (`requireAuth` re-checks the flag). The Users panel and the super admin user list now show an Active/Inactive badge and a toggle button.
- **Per-admin user management isolation (own business only).** A comercio admin can create, delete, role-change, enable/disable and reset the passwords of every user of their own business — other admins included — except the account they are logged in as (their own password goes through the dedicated "change password" screen). Users of other businesses are never reachable, and registering an already-registered comercio remains impossible.
- **Prompt editor modal.** Clicking the prompt field (or the "Edit in large window" button) now opens a large modal so the admin can edit the prompt comfortably instead of typing in a small inline textarea. The modal closes on "Apply" or "Cancel"; applying while the system default prompt is shown automatically turns off "Use default prompt" and saves the edited text as the custom prompt. (v1.2.1)
- **Concurrent AI autocomplete pool.** The product autocomplete runs AI calls in parallel instead of sequentially, dramatically reducing total time (e.g. ~120 s instead of ~600 s for 60 products at 10 s each). The concurrency is configurable per AI provider (default 5, range 1–50) and stored alongside the provider settings. The browser limits keep-alive connections per host, so the pool respects real-world browser constraints.
- **Request context in log lines.** Every log line produced during an authenticated request now includes `[comercio=<id> user=<id>]` after the timestamp, making it easy to trace which business and user triggered a specific log entry. Log lines outside a request context (e.g. startup, health checks) are unchanged.
- **`.node-version` file (root) pinning Node 22**, so hosting platforms (Railway via Railpack, Plesk/nodenv, CI) select a modern Node instead of defaulting to an old one.
- **`postinstall` script in the root `package.json`** that automatically installs the `frontend` and `backend` dependencies. This fixes deploys on platforms (e.g. Railway) that only run `npm install` at the repo root, where the frontend `tsc`/Vite build would otherwise fail with `sh: 1: tsc: not found`.
- **`LOG_FILE` env var for optional file-based logging.** When set to a non-empty path, the backend logger appends to that file in addition to console; when empty/undefined it prints to console only (unchanged default behaviour).
- **`LOG_MAX_SIZE` and `LOG_MAX_FILES` env vars for log rotation.** When `LOG_FILE` is set, the file is rotated once it reaches `LOG_MAX_SIZE` (default `10mb`, accepted with `kb`/`mb`/`gb` suffixes; `0` disables rotation) keeping `LOG_MAX_FILES` (default `5`) archived copies (`<file>.1` … `<file>.N`); `LOG_MAX_FILES=0` truncates in place. Rotation failures are silent, matching the existing file-logging behaviour.
- **Per-AI-provider request timeout.** The settings screen now lets an admin configure a timeout (seconds) for each AI provider, stored like the rest of the provider settings in SQLite (`ai_provider_config`). Leaving the field empty reverts to the 30-second default. The value is applied to the provider HTTP calls (autocomplete, generation, connection test) in milliseconds.
- **Correlation id (nonce) in AI logs.** Every AI autocomplete call is tagged with a generated `requestId` (also usable by the caller), and the request/response/HTTP-call/HTTP-response log lines carry it as `[id]`, so the ~4 lines of a single exchange can be correlated even under concurrent requests.
- **AI image URL validation with automatic retry.** Every image URL the AI returns is verified by the app before acceptance: an HTTP GET must confirm the URL is reachable and actually serves an image (Content-Type `image/*`), an HTTP 200 alone is not considered proof (many pages answer 200 with HTML). When the product still needs images and none of the returned URLs holds up (or the array is empty), the provider is asked again with a fixed image-only message ("please find real URLs of images related to this reference … and brand …"), the second answer is parsed as JSON and its (also validated) URLs fill the product. The retry is logged as `URLs para el producto <ref> no válidas, pidiendo imágenes de nuevo`, and the two AI calls share the same correlation id.

### Changed
- **Image-provider tests run against pure mocks without real credentials.** The engine/route tests stub the HTTP layer (`http-client`) and URL validation (`fetch`) and now feed the providers dummy credentials (`test-key`, `test-user`, …) instead of reading the real API keys/passwords from the external GetImages proof-of-concept `config.json` — the unit tests are fully hermetic and never touch the real services.
- **Product images moved out of the AI flow.** The AI prompt/contract no longer asks for `image_urls`; autocomplete returns the image URLs from the image-provider engine (`searchProductImages`) in the same response, and the mock AI provider stops inventing image URLs. The image URL validation still runs, but over the provider URLs instead of the AI answers.
- **The round-robin cursor now rotates past the last-called provider.** The engine starts each search *after* the last-called provider instead of retrying it, so calls actually rotate through every enabled service.
- **`walkImages` lists image URLs held in arrays** under image-looking keys (e.g. `images: ["url"]`), which several provider responses (BarcodeLookup, Tavily…) use.
- **The whole AI prompt is now sent in the UI language.** Until now only the system default prompt was translated (ES/EN) while the fixed parts appended below it — the JSON response contract and the "images needed" instruction — were always in Spanish. The whole message the AI receives (default/custom prompt + fixed contract + image instruction) is now built in the same language (Spanish or English).
- **Minimum Node bumped from 18 to 22** across root/frontend/backend `package.json` `engines`, README (EN/ES), INSTALLATION docs (EN/ES), and the CI workflow example in TESTING docs (EN/ES). Vite 7, Sass, Vitest and other frontend build deps require Node `^20.19 || >=22`, so Node 18 would install with `EBADENGINE` warnings and the build could fail.
- **`FRONTEND_URL` is now optional in production.** It is only used as the development CORS origin and as a fallback origin for mock autocomplete images (the request origin is used first).
- **Deployment docs updated** for persistent hosting (Railway): attach a volume and point `DATA_DIR`/`LOG_FILE` inside it, otherwise `catalogai.db` is recreated on every deploy. Removed the obsolete `CONFIG_SECRET` references from the environment block and the security checklist (config storage migrated to SQLite).
- **"Import" wording replaced with "Load"** across the UI (ES/EN). The fetch screen is now "Load products from PrestaShop" ("Cargar productos desde PrestaShop") and the grid is "Loaded products" ("Productos cargados"), since the app pulls products from PrestaShop and updates them rather than performing a traditional import/export.
- **Login lands on the product search/load screen.** After login the dashboard no longer jumps straight to the loaded products grid (the previous auto-redirect when an AI provider was configured) — admins start on "Cargar productos desde PrestaShop"; only shops without PrestaShop configured still open the configuration screen.
- **Loaded data is cleared on logout and login.** The in-memory PrestaShop dataset is dropped on logout and when a new login starts, so a session never shows products fetched by a previous session.
- **Provider timeout errors show the configured value.** When a browser call times out, the UI no longer shows the raw axios "timeout of 65000ms exceeded"; it reports the actually configured provider timeout (e.g. "did not respond within the configured 60 seconds").
- **The fixed AI instructions now forbid invented image URLs and demand verified ones.** The response-contract section (`REGLAS PARA image_urls` / `RULES FOR image_urls`) and the dynamic "images needed" instruction now order the model to check every URL with an HTTP GET and confirm the response is actually an image (Content-Type `image/jpeg`/`image/png`), explicitly warning that an HTTP 200 alone is not enough (many pages reply 200 with HTML). Inventing or guessing URLs is described as a serious failure, and the model must prefer returning an empty `image_urls` array over fake URLs.

### Fixed
- **Provider feed rows keep their id.** `addProviderFeedImage` read `last_insert_rowid()` after `persist()`, which reset the connection value, so new feed rows lost their id; the id is read before persisting (same as `createComercio`).
- **PrestaShop clients no longer crash with a "Converting circular structure to JSON" error when a shop answers with an HTML page.** PrestaShop returns its front/admin login page (HTTP 200, HTML) instead of the Webservice XML when the base URL points to an admin panel path or the Webservice is disabled. The XML parser then threw an error carrying a self-referencing `note` property, and the logger's `JSON.stringify` blew up on it, replacing the real error with a cryptic message. The client now detects HTML bodies before parsing (and during the connection test) and reports a clear message telling the admin that the base URL must point to the Webservice API (the store root plus /api, e.g. https://shop.example.com/api), and the connection test surfaces the specific reason instead of a generic failure; the logger also serializes circular values safely so it can never mask a real error again.
- Bumped `nanoid` to `^3.3.18` to address a high-severity advisory (GHSA-2v37-7h3g-55p8). The app calls `nanoid(8)` with a fixed size, so it was not exposed, but the dependency is now patched. In the frontend, `postcss` pulls `nanoid@3.3.17`, so an `overrides` entry forces `3.3.18` for the whole tree (`npm audit` now reports 0 vulnerabilities project-wide).
- **The AI requests no longer hit the frontend's hardcoded 30-second timeout.** The shared API client used to abort `/autocomplete` and `/config/test/ai` at 30 s, so a per-provider timeout above the default (e.g. 60 s) was cut short by the browser and the user saw the raw axios "timeout of 30000ms exceeded" message. Those two endpoints now wait the configured provider timeout plus a 5-second grace period, letting the backend enforce its own timeout and return the translated error.
- **`/auth/me` now reports the real configuration state.** The auth routes ran before the per-comercio config middleware, so `req.store` was always missing on `/me` and `prestashop_configured` was always `false` (the admin was sent to the configuration screen even after setting everything up). The config middleware now runs on `/api/auth` too, and `/me` also returns `ai_configured`.
- **Product editor modal save no longer drops pending edits.** The edit diff is computed against the raw imported product instead of the already-merged one, so saving a single field keeps the previously pending edits of that product.
- **Product editor modal save no longer drops previously AI-added images.** The image portion of the edits (`image_urls`, `local_images`, `images_to_delete`) is carried forward and the modal's add/delete actions are applied on top of it, so AI-autocompleted images survive a subsequent save.
- **Mock autocomplete images are no longer hardcoded to `http://localhost:5173`.** The mock provider builds `image_urls` from the request origin (scheme + `Host`, honouring `X-Forwarded-Proto` via `trust proxy`), so they resolve on the deployed server; `FRONTEND_URL` is only a fallback. `proxyImageUrl` passes same-origin URLs through unchanged so these images load directly.

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
- **User registration flow**: a "Registrar nuevo comercio" link on the login page opens a form to create a new business with its first admin user. The endpoint `POST /api/auth/register-comercio` creates the comercio, seeds its default marketplaces and AI providers, creates the admin user and returns a success message (no auto-login). A single-use invitation nonce minted by the super admin is now required.
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
- AI provider seed names are lowercase (`mock`, `openai`, `anthropic`, `openrouter`) matching `AIProviderName` type exactly.
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
