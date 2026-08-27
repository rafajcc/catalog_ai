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
│  │  Database (SQLite via sql.js)            │               │
│  │  catalogai.db                            │               │
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
├── ai-text-suggester/      # AI text generation and image URL extraction
│   ├── autocomplete.ts     # AI completion logic with web/image search
│   ├── default-prompts.ts  # ES/EN default prompts with mandatory search
│   └── providers/          # Provider implementations (OpenAI, Anthropic, etc.)
├── prestashop-client/      # PrestaShop Webservice API client
├── prestashop-fetcher/     # Product fetching by reference/brand with filters
├── config-persistence/     # Legacy encrypted config file persistence
├── database-persistence/   # Per-comercio SQLite persistence (sql.js)
└── auth/                   # Authentication & multi-tenant user management
    ├── auth.ts             # JWT, bcrypt, password validation
    ├── routes.ts           # Login, register, user management endpoints
    ├── middleware.ts        # requireAuth, requireRole middleware
    ├── database.ts         # Schema, user/comercio queries
    └── load-config-middleware.ts  # Per-request DataStore from DB
```

### Database
- **Engine**: SQLite via sql.js (pure WASM, no native dependencies)
- **Schema**: Idempotent `CREATE TABLE IF NOT EXISTS` — the database is never deleted or recreated on startup
- **Multi-tenancy**: All config tables scoped by `comercio_id` FK
- **Global tables**: `marketplaces` and `ai_providers` (shared across tenants)
- **Junction tables**: `comercio_marketplaces` and `comercio_ai_providers`
- **Persistence**: Writes to `catalogai.db` on every change

### Security
- **Credentials**: Encrypted at rest (AES-256-GCM), never exposed in frontend
- **JWT**: httpOnly cookies with access + refresh tokens
- **Password hashing**: bcrypt with cost factor 12
- **Account lockout**: 5 failed attempts / 15 minutes
- **Encryption key**: From `CONFIG_SECRET` env var or auto-generated `config.json.key`

### AI Integration
- **Providers**: OpenAI, Anthropic, OpenRouter, GPT4All, Mock (for testing)
- **Web search**: Mandatory web search for product data enrichment
- **Image search**: Dynamic image count injection based on current product images
- **Response format**: JSON with structured fields (name, description, meta, image_urls)
- **Default prompts**: Include "BÚSQUEDA WEB OBLIGATORIA" and "BÚSQUEDA DE IMÁGENES"

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
- **AppHeader**: Status chip, language toggle, settings/users buttons, user info
- **ConfigurationForm**: PrestaShop + AI provider settings, dirty state tracking
- **UploadSection**: PrestaShop import panel with filters
- **ProductsViewPage**: Product grid with inline editing, AI autocomplete, image lightbox
- **UserManagementPage**: Admin-only user CRUD

### Backend Status
- Polls `/api/health` endpoint every 30 seconds
- Status displayed as chip in header (Online/Offline/Degraded)
- Auto-recovers when backend comes back online

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
2. Backend sends product data + mandatory search instructions to AI
3. AI returns JSON with enriched fields (name, description, meta, images)
4. Backend extracts and validates response
5. Frontend updates product grid with proposals
6. User can accept/reject individual changes
7. Changed fields pushed back to PrestaShop via Webservice

### Image Search Flow
1. Backend calculates `imagesNeeded = 5 - (product.images?.length ?? 0)`
2. If > 0, appends dynamic instruction to AI prompt with exact count
3. AI searches for and returns image URLs
4. Frontend caps to `imagesNeeded` as safety net
5. Images displayed in product grid via backend proxy
