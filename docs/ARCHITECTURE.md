# Architecture

Technical architecture and internal design decisions for Catalog AI.

## Overview

Catalog AI is a full-stack application with an Express.js backend and React frontend, using SQLite for per-tenant persistence. In production, the backend serves both the API and the built frontend from a single process on a single port.

```
┌─────────────────────────────────────────────────────────────┐
│  Express Server (single process, single port)              │
│  http://localhost:3000                                      │
│                                                             │
│  ┌──────────────────────────────────────────┐               │
│  │  Frontend (React + TypeScript, static)   │               │
│  │  served from backend/public/             │               │
│  └──────────────────────────────────────────┘               │
│  ┌──────────────────────────────────────────┐               │
│  │  API (/api/*)                            │               │
│  └──────────────────────────────────────────┘               │
│  ┌──────────────────────────────────────────┐               │
│  │  Data access (sync driver)             │               │
│  │  sqlite (default) · mysql / mariadb    │               │
│  └──────────────────────────────────────────┘               │
└─────────────────────────────────────────────────────────────┘
```

In development, the frontend runs on its own Vite dev server (http://localhost:5173) which proxies `/api` requests to the backend (http://localhost:3000). In production, `npm run build` copies the built React app into `backend/public/`, which Express serves as static files with an SPA fallback.

## Backend Architecture

### Server Architecture
- Express.js provides a lightweight, scalable web framework
- Module-based architecture with clear separation of concerns
- Each module handles a single responsibility

### Module System

```
backend/src/modules/
├── ai-text-suggester/      # AI text generation
│   ├── autocomplete.ts     # Prompt building, JSON contract parsing, proposals
│   ├── default-prompts.ts  # ES/EN default prompts with mandatory web search
│   └── image-url-validation.ts  # HTTP validation of image URLs before use
├── ai-providers/           # AI providers as per-service classes + registry
│   └── providers/          # OpenAI, Anthropic, OpenRouter, Mock
├── image-providers/        # Image provider services + engine (feeds first, round robin)
│   ├── router.ts           # Super-admin endpoints (/api/superadmin/image-providers)
│   ├── registry.ts         # Service definitions + idempotent DB seeding
│   ├── services/engine.ts  # Feeds-first lookup, round-robin search, billing cycles
│   ├── utils/http-client.ts# Shared HTTP client for the providers (axios)
│   └── providers/          # Apify, SerpAPI, Serper, Brave, DataForSEO, Mock, feeds, ...
├── prestashop-client/      # PrestaShop Webservice API client
├── prestashop-fetcher/     # Product fetching by reference/brand with filters
├── database-persistence/   # Per-comercio config persistence (DatabaseAdapter-backed)
└── auth/                   # Authentication & multi-tenant user management
    ├── auth.ts             # JWT, bcrypt, password validation
    ├── routes.ts           # Login, register, user management endpoints
    ├── middleware.ts       # requireAuth, requireRole middleware
    ├── database.ts         # Domain queries which stay synchronous per dialect
    ├── mysql-driver.ts     # Sync MySQL client (worker_threads + mysql2/promise)
    ├── load-config-middleware.ts  # Per-request DataStore from DB
```

### Database

- **Configurable backend**: `DB_TYPE` is the mandatory engine selector. `DB_TYPE=sqlite`
  keeps the embedded SQLite file (`catalogai.db`, via sql.js, no native deps, whole-file
  `persist()` per write). Setting `DB_TYPE=mysql|mariadb` switches to an external
  MySQL/MariaDB server (connection via the `DB_*` variables). PostgreSQL is not supported
  yet and fails at boot with a clear error. Full design: [DATABASE.md](DATABASE.md).
- **Synchronous surface**: the domain layer keeps calling `runDb`/`queryAll`/`queryOne`
  synchronously; the external driver bridges the async `mysql2` client through a worker
  thread + MessagePort + `Atomics.wait`, so the business logic never changed.
- **Schema**: Idempotent `CREATE TABLE IF NOT EXISTS` (never deleted or recreated on startup),
  translated per dialect (SQLite/MySQL/MariaDB) — multi-tenancy and tables unchanged.
- **Multi-tenancy**: All config tables scoped by `comercio_id` FK
- **Global tables**: `marketplaces`, `ai_providers` (shared across tenants), `image_providers`
- **Junction tables**: `comercio_marketplaces`, `comercio_ai_providers`
- **Persistence**: sql.js exports `catalogai.db` on every change; external adapters rely on
  server-side persistence (their `persist()` is a no-op)

### Security
- **Credentials**: Stored in the SQLite database, never exposed in frontend (masked)
- **JWT**: httpOnly cookies with access + refresh tokens
- **Password hashing**: bcrypt with cost factor 12
- **Account lockout**: 5 failed attempts / 15 minutes

### AI Integration
- **Providers**: OpenAI, Anthropic, OpenRouter, Mock (for testing), implemented as per-service classes registered in `ai-providers/registry.ts`.
- **Web search**: Mandatory web search for product data enrichment (kept in the prompt).
- **Scope**: The AI only proposes the empty text fields (`description_short`, `description`, `meta_title`, `meta_description`) as structured JSON. Image URLs are NOT requested from the AI — they come from the image provider engine.
- **Default prompts**: Include "BÚSQUEDA WEB OBLIGATORIA" plus the fixed JSON-response contract.

### Image Providers
- **Two disjoint layers**: the provider services (`image-providers/providers/*`) speak HTTP to their vendors through the shared `utils/http-client.ts`; the engine (`services/engine.ts`) orchestrates them.
- **Feeds first**: when enabled, the `feeds` service matches brand/reference/EAN against the `provider_feed_images` DB table before any third-party call (free, no billing). It is **not part of the round robin** and it never advances the round-robin cursor.
- **Round robin**: the enabled providers (everyone except `feeds`) are tried in `sort_order`, always starting after the last-called provider, up to 5 real calls per product search.
- **Billing cycles**: each provider has an optional `max_calls_per_month` + `billing_cycle_day`; counters roll over automatically and are exposed to the super admin. Over-quota or unconfigured providers are skipped without consuming the per-search budget.
- **Validation**: every candidate URL is HTTP-validated (`image-url-validation.ts`) before reaching the frontend; results are capped at 5.

### Image Handling
- **Proxy-only**: No disk storage, images fetched live from external URLs
- **Backend proxy**: `GET /api/images/proxy?url=...` with 15s timeout, content-type validation
- **Frontend proxy**: `proxyImageUrl()` in ApiService applies proxy to all images
- **PrestaShop save**: Backend downloads from external URL server-side and uploads via Webservice

## Frontend Architecture

### Component Structure
- **Component-Based**: Modular React components for each screen/purpose
- **State Management**: React useState + useEffect, no Redux/Zustand
- **Routing**: State-based routing (login → register → dashboard), no React Router

### Key Components
- **AppHeader**: Status chip, version badge (from `GET /api/status`), language toggle, settings/users buttons, user info
- **ConfigurationForm**: PrestaShop + AI provider settings, dirty state tracking
- **UploadSection**: PrestaShop import panel with filters
- **ProductsViewPage**: Product grid with inline editing, AI autocomplete (text fields) + image suggestions, image lightbox
- **UserManagementPage**: Admin-only user CRUD
- **SuperAdminPage**: Platform super admin — business management, image provider services panel, provider feeds table

### Backend Status
- Polls `GET /api/status` every 30 seconds (version + heartbeat)
- Status displayed as chip in header (Online/Offline/Degraded); the version badge reads the same response

### Internationalization
- **Default language**: Spanish (es)
- **Available**: English (en)
- **Storage**: Preference persisted in `localStorage`
- **Implementation**: Custom I18nProvider context, no external i18n library

## Data Flow

### Product Import
1. User configures PrestaShop connection (URL, API key)
2. User optionally sets filters (references, brand, description, images)
3. Backend fetches products via PrestaShop Webservice API
4. Products stored in-memory (not database)
5. Frontend displays in grid with SEO fields and image thumbnails

### AI Autocomplete
1. User selects products to enrich
2. Backend loads the stored prompt (custom or default for the UI language) and sends each product + the fixed JSON-response contract to the AI
3. AI returns JSON with the proposed text fields only (short/long description, meta title, meta description)
4. Backend validates the response, merges the non-empty proposals, and resolves the product images with the image-provider engine in the same request
5. Frontend updates product grid with proposals and thumbnails
6. User can accept/reject individual changes
7. Changed fields pushed back to PrestaShop via Webservice

### Image Search Flow
1. Engine reads the enabled providers from the DB (`image_providers`) with their credentials, sort order and billing counters
2. If the `feeds` service is enabled, its table (`provider_feed_images`) is queried first by brand/reference/EAN
3. On a miss, providers are tried round-robin (starting after the last-called one) up to 5 real calls per product
4. The first provider returning >= 1 validated image wins; sources are logged per attempt
5. Returned URLs (max 5) are HTTP-validated, displayed through the backend proxy and saved to PrestaShop on demand
