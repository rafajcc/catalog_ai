# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Multi-tenant authentication system**: each "comercio" (business/shop) has its own isolated set of users, marketplace configs, AI provider configs and prompts. All configuration tables are scoped by `comercio_id` foreign key.
- **User registration flow**: a "Registrar nuevo comercio" link on the login page opens a form to create a new business with its first admin user. The endpoint `POST /api/auth/register-comercio` creates the comercio, seeds its default marketplaces and AI providers, creates the admin user and auto-logs in.
- **Login page**: users sign in with username and password only; the comercio is derived from the user's record (users belong to exactly one comercio). Failed login attempts trigger account lockout after 5 attempts within 15 minutes.
- **JWT authentication**: access and refresh tokens issued as httpOnly cookies. `TokenPayload` carries `sub`, `username`, `role`, `comercio_id` and `comercio_slug`. Roles are `admin` (full access) and `user` (read-only config). Endpoints `PUT /api/config`, user management and config reset require admin role.
- **Per-request config loading**: the `loadComercioConfig` middleware creates a fresh `DataStore` per authenticated request, loading the comercio's configuration from the database via `DatabasePersistence(comercioId)`. Data never leaks between tenants.
- **SQLite multi-tenant database**: schema includes `comercios`, `users`, `login_attempts`, `marketplaces`, `ai_providers`, `marketplace_config`, `ai_provider_config` and `app_settings` tables, all scoped by `comercio_id`. Persists to `catalogai.db` via sql.js (pure WASM, zero native deps).
- **API key masking**: `GET /api/config` returns `api_key: ""` with `has_api_key: boolean` so the frontend never sees real keys. `PUT /api/config` preserves existing keys when an empty string is sent.
- **Autocomplete real-time errors**: AI autocomplete now shows errors as they happen during the sequential product loop, accumulating a list of `{reference, message}` pairs displayed in a scrollable error panel.
- **Default prompt restore**: `POST /api/config/reset-prompt` deletes the custom prompt and reverts to the system default.
- App header shows on login and register pages (app name + language selector only); status, settings and logout buttons are only visible when authenticated.
- Logout button in the app header (dashboard view) logs the user out and returns to the login page.
- State-based routing in `App.tsx`: login → register → dashboard, with session check via `GET /api/auth/me` on startup.
- "Registrar nuevo comercio" link styled as an underlined text link on the login page.

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

### Fixed
- `DatabasePersistence.load()` always returns an object even when no config exists for a comercio.
- `createComercio` seed logic corrected to use subquery for `last_insert_rowid()`.
- `enabled_fields` type in `DatabasePersistence` now correctly typed as `AIContentField[]`.
- Backend route handlers all use `req.store` (per-request) instead of module-level `store`.

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
- Frontend test suite: API service, hooks, layout, configuration form, PrestaShop import panel and dashboard flow (jest + RTL).
- MIT `LICENSE` and this changelog referenced from the README.

[Unreleased]: https://github.com/rafajcc/catalog_ai
[0.1.0]: https://github.com/rafajcc/catalog_ai/releases/tag/v0.1.0
