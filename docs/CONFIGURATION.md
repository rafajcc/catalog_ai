# Configuration

Detailed configuration reference for Catalog AI.

## Overview

Configuration is per-business ("comercio"). Each business has its own isolated settings stored in the SQLite database.

## Configuration Access

- **Admin users**: Full access (read/write)
- **Regular users**: Read-only access

Click the settings icon (⚙) in the header to open the configuration panel.

## PrestaShop Configuration

### Required Fields

| Field | Description | Example |
|---|---|---|
| **Base URL** | Your PrestaShop store URL | `https://shop.example.com` |
| **API Key** | PrestaShop Webservice API key | `BCDEFGH12345...` |

### Optional Fields

| Field | Description | Default |
|---|---|---|
| **Version** | PrestaShop version | `8.1.0` |
| **Language ID** | Default language for product data | `1` (English) |

### Getting Your API Key

1. Log in to PrestaShop admin
2. Go to **Advanced Parameters > Webservice**
3. Click **Add new webservice key**
4. Select resources: `products` (read), `products` (write)
5. Copy the generated key

### Testing Connection

Click "Probar conexión PrestaShop" / "Test PrestaShop connection" to verify:
- URL is accessible
- API key is valid
- Webservice API is enabled

## AI Provider Configuration

### Available Providers

| Provider | Description | API Key Required |
|---|---|---|
| **OpenAI** | GPT-4, GPT-3.5 | Yes |
| **Anthropic** | Claude | Yes |
| **OpenRouter** | Multi-provider gateway | Yes |
| **Mock** | Testing (no real AI) | No |

### Required Fields

| Field | Description | Example |
|---|---|---|
| **Provider** | Select from dropdown | `openai` |
| **Model** | Model name | `gpt-4` |
| **API Key** | Provider API key | `sk-...` |

### Optional Fields

| Field | Description | Default |
|---|---|---|
| **Base URL** | Custom API endpoint | Provider default |
| **Language** | Response language | `es` (Spanish) |
| **Temperature** | Creativity (0-1) | `0.7` |
| **Timeout** | Request timeout in seconds. Empty = default | `30` seconds |
| **Concurrency** | Max parallel AI calls during autocomplete (1–50). Empty = default | `5` calls |

### Testing Connection

Click "Probar conexión IA" / "Test AI connection" to verify:
- API key is valid
- Model is accessible
- Provider responds correctly

## AI Prompt Configuration

### Default Prompt

The system includes a default prompt optimized for:
- Mandatory web search for product data
- Image search with dynamic count injection
- Structured JSON response format

### Using Default Prompt

Check "Usar prompt por defecto" / "Use default prompt" to:
- Automatically load the system default prompt
- Receive updates when the prompt is improved
- Reset to default at any time

### Custom Prompt

Uncheck "Usar prompt por defecto" to edit the prompt manually.

**Warning:** Custom prompts will be overwritten if you re-enable the default prompt.

### Reset to Default

Click "Restablecer prompt" / "Reset prompt" to restore the system default.

### Prompt Structure

The default prompt includes:

1. **BÚSQUEDA WEB OBLIGATORIA** (Mandatory Web Search)
   - Always search for real product information
   - Verify specifications and features
   - Find accurate descriptions

2. **Response Format**
   - Structured JSON with specific text fields
   - SEO-optimized meta fields
   - The AI only fills the empty text fields (`description_short`, `description`, `meta_title`, `meta_description`). Product images never come from the AI — they are resolved by the image-provider engine (see *Image Providers* below).

## Image Providers

Product images for autocomplete are resolved by the image provider services, **not by the AI**. The super admin configures them from the **Image Services** panel (only the super admin sees it).

### How they are used

1. **Feeds first, outside the round robin.** The `feeds` service (enabled by default) matches the product brand/reference/EAN against the `provider_feed_images` table. It is free, never counts against billing and — whenever it is enabled — it is **always** the first service called, before any other. `feeds` is **not part of the round robin**: it never advances the global cursor and is skipped by it.
2. **Round robin (the rest, after feeds).** The remaining enabled services (everyone except `feeds`) are called in order (`sort_order`), one per product search, always starting after the provider that made the last real call. Example: if business A used service #3 for product X, the next search (business B, product Y) starts at service #4.
3. **Billing.** Each provider has an optional `max_calls_per_month` allowance and a `billing_cycle_day`; the counter resets automatically when the cycle day passes. Providers without a configured API key, without allowance left, or not implemented are skipped without consuming the per-search budget (max 5 real provider calls per search).

### Available services

Most services require an **API key** (`auth_kind: api_key`), some a **username/password pair** (`user_password`) and a few none (`mock`, `ddgs`, `feeds`). The registry also lists the two brand crawlers (Playwright and plain HTML) as **not implemented** — they cannot be enabled yet. The `mock` service is enabled by default so development and the test suite work without external keys.

| Slug | Service | Auth |
|---|---|---|
| `mock` | Mock (development) | none |
| `feeds` | Provider feed table | none |
| `ddgs` | DuckDuckGo Images | none |
| `apify` | Apify (Google Images scraper actor) | api_key + `actor_id` |
| `barcodelookup` | BarcodeLookup (by EAN) | api_key |
| `brave_images` | Brave Images API | api_key |
| `brightdata` | Bright Data (Google Images SERP) | api_key + `zone` |
| `dataforseo` | DataForSEO (Google Images) | user_password + `location_name` / `language_name` |
| `decodo_premium` | Decodo | user_password |
| `exa` | Exa (semantic search) | api_key |
| `firecrawl` | Firecrawl | api_key |
| `nexscope` | Nexscope (Amazon search) | api_key + `marketplace` |
| `openserp` | OpenSERP | api_key |
| `oxylabs` | Oxylabs (Google Images) | user_password |
| `scraperapi` | ScraperAPI (Google Images) | api_key |
| `searchapi` | SearchAPI (Google Images) | api_key |
| `serpapi` | SerpAPI (Google Images) | api_key |
| `serper` | Serper (Google Images) | api_key |
| `skumonster` | SkuMonster (UPC/EAN/SKU) | api_key + `base_url` |
| `tavily` | Tavily | api_key |
| `zenserp` | Zenserp | api_key |
| `scraper_js` / `scraper` | Brand crawlers (Playwright / web) | none — **not implemented** |

Credentials (API keys, usernames, passwords) are stored in the `image_providers` table of the SQLite database and are **read at request time** by the engine when an autocomplete search needs them — nothing is read from the old GetImages `config.json`. The panel only shows whether each credential is configured (`has_api_key`, `has_username`, `has_password`) and never returns the stored values. Image providers are platform-global (not per-business) and managed by the super admin.

### Provider feeds table

The `feeds` service looks up the `provider_feed_images` table (brand + reference/EAN + image URL). The super admin can add, search and delete rows from the panel or through the API `GET/POST/DELETE /api/superadmin/image-providers/feeds`. When enabled, the engine queries this table before the round-robin providers run (feeds is not part of the round robin); the first hit with a valid image wins.

## Marketplace Configuration

### Supported Marketplaces

| Marketplace | Status |
|---|---|
| **PrestaShop** | Supported |
| **WooCommerce** | Planned |
| **Shopify** | Planned |

## Security

### API Key Storage

PrestaShop and AI provider API keys are stored in the SQLite database (`ai_provider_config` / `marketplace_config`) and are never exposed in API responses (masked as `XXXX...XXXX`). Image provider credentials are stored in the `image_providers` table and are likewise never exposed — only `has_*` flags are returned.

> Note: The previous AES-256-GCM file-based encryption (`CONFIG_SECRET` / `config.json.key`) has been removed. Configuration is now persisted in the SQLite database.

### JWT Tokens

- **Access token**: Short-lived (15 minutes)
- **Refresh token**: Long-lived (7 days)
- **Storage**: httpOnly cookies (not accessible via JavaScript)
- **Signing**: HS256 with `JWT_SECRET` (access) and `JWT_REFRESH_SECRET` (refresh)

### Password Requirements

- Minimum 8 characters
- At least 1 uppercase letter
- At least 1 lowercase letter
- At least 1 number
- Stored with bcrypt (cost factor 12)

### Account Lockout

- **Threshold**: 5 failed attempts
- **Duration**: 15 minutes
- **Reset**: Wait 15 minutes or restart backend

## Database

The persistence layer is pluggable: embedded SQLite or an external MySQL/MariaDB
server. `DB_TYPE` is the **only** selector and it is **mandatory**: the app refuses
to boot without it. See [DATABASE.md](DATABASE.md) for the technical design.

### Location (SQLite)

Stored in the data directory as `catalogai.db`:

- The path is `<DATA_DIR>/catalogai.db`.
- Default: the directory of the compiled entry point (`backend/dist/`). **Set `DATA_DIR`** in production to a writable directory.
- In local development (backend `npm run dev`), the default is the backend directory itself.

### External database (MySQL / MariaDB)

Set `DB_TYPE=mysql` (or `mariadb`) plus `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`,
`DB_PASSWORD` (and `DB_SSL=true` when the server requires TLS). `DB_HOST`, `DB_NAME`,
`DB_USER` and `DB_PASSWORD` are required — if any is missing the app refuses to boot.
`DB_PORT` defaults to 3306; `DB_SSL` and `DB_MAX_POOL` are optional. The same schema,
seed rows and migrations are applied at boot; `DATA_DIR` is ignored and the database
provider persists the data. Default pool size: `DB_MAX_POOL=10`. PostgreSQL is not
supported yet: `DB_TYPE=postgres` fails at boot with a clear error.

### Backup

```bash
cp <DATA_DIR>/catalogai.db backup/catalogai_$(date +%Y%m%d).db
```

### Reset

```bash
rm <DATA_DIR>/catalogai.db
cd backend && npm run dev
```

**Warning:** This deletes all data.

### Schema

The database uses idempotent `CREATE TABLE IF NOT EXISTS` — it is never deleted or recreated on startup. Current schema version: 7 (registration nonces).

**Tables:**
- `users` - User accounts (`active`, `must_change_password`, role, business FK)
- `comercios` - Businesses
- `marketplaces` - Marketplace definitions (global)
- `ai_providers` - AI provider definitions (global)
- `comercio_marketplaces` - Business-marketplace mapping
- `comercio_ai_providers` - Business-AI provider mapping
- `comercio_configs` - Business configurations
- `app_settings` - Application settings
- `image_providers` - Image provider services (platform-global): slug, name, enabled, round-robin `sort_order`, config JSON with credentials, billing counters
- `provider_feed_images` - Feed image rows (brand / reference / EAN / image URL) used by the `feeds` service
- `registration_nonces` - Single-use invite codes: code, expiry, active/used flags, who created/consumed them

## Environment Variables

### Backend (.env)

A template is provided at `.env.example` (project root).

| Variable | Required | Default | Description |
|---|---|---|---|
| `NODE_ENV` | prod | — | `production` disables CORS, serves the built frontend and hides verbose errors |
| `JWT_SECRET` | prod | dev placeholder | Signs access tokens |
| `JWT_REFRESH_SECRET` | prod | dev placeholder | Signs refresh tokens |
| `ADMIN_USER` | — | — | Optional super admin username (plaintext). Together with `ADMIN_PASSWORD` creates the super admin account; sessions stop working if the variables are removed |
| `ADMIN_PASSWORD` | — | — | Optional super admin password as a **bcrypt hash** (12 rounds), generated with `node -e "const b=require('bcryptjs'); b.hash('tu-password',12).then(h=>console.log(h))"` in `backend/`. If either variable is missing, nobody can sign in as super admin |
| `DATA_DIR` | prod (sqlite) | entry-point dir | Writable directory where `catalogai.db` is stored (SQLite only) |
| `DB_TYPE` | required | — | Database engine selector: `sqlite`, `mysql` or `mariadb`. **Mandatory**: without it the app refuses to boot |
| `DB_HOST` | ext | — | External database host (required when `DB_TYPE=mysql`/`mariadb`) |
| `DB_PORT` | ext | `3306` | External database port (optional, defaults to 3306) |
| `DB_NAME` | ext | — | External database name (required when `DB_TYPE=mysql`/`mariadb`) |
| `DB_USER` | ext | — | External database user (required when `DB_TYPE=mysql`/`mariadb`) |
| `DB_PASSWORD` | ext | — | External database password (required when `DB_TYPE=mysql`/`mariadb`) |
| `DB_SSL` | — | `false` | Enable TLS for the external connection (mysql/mariadb) |
| `DB_MAX_POOL` | — | `10` | Connection pool size for the external database |
| `PORT` | — | `3000` | HTTP port |
| `LOG_LEVEL` | — | `info` | Logging level (`debug`, `info`, `warn`, `error`) |
| `LOG_FILE` | — | — | Optional path to append log lines to a file (in addition to console). The parent directory must exist; if the file cannot be written the failure is silent |
| `LOG_MAX_SIZE` | — | `10mb` | Rotate the log file once it reaches this size (bytes, or a `kb`/`mb`/`gb` suffix; `0` disables rotation) |
| `LOG_MAX_FILES` | — | `5` | Number of rotated archives kept (`<file>.1` … `<file>.N`); `0` truncates instead of archiving |
| `FRONTEND_URL` | — | `http://localhost:5173` | Optional. CORS origin in development; fallback origin for mock autocomplete images. Not used in production (CORS is disabled same-origin) |
| `RATE_LIMIT_WINDOW_MS` | — | `900000` | Rate limit window (ms) |
| `RATE_LIMIT_MAX` | — | `100` | Max requests per window |
| `MAX_BODY_SIZE` | — | `10mb` | Max JSON/body size |

**Deprecated (no longer used):** `CONFIG_SECRET`, `CONFIG_FILE` — removed with the migration to SQLite storage for configuration.

> **Note:** The application does not load `.env` files itself. You must either: (a) load the `.env` via the hosting panel / process manager, or (b) configure these as environment variables in your hosting panel.

### Frontend

No environment variables required. In development, `vite.config.ts` proxies API requests:
- API proxy: `/api` → `http://localhost:3000`
- Dev server: `http://localhost:5173`

In production, the frontend is built and served directly by the backend (no proxy needed).

## Troubleshooting

### Configuration Not Saving

1. Ensure you're logged in as admin
2. Check browser console for errors
3. Verify backend is running
4. Check `<DATA_DIR>/catalogai.db` exists and is writable

### API Key Not Working

1. Verify key is correct (no extra spaces)
2. Test connection using the test button
3. Check provider status page
4. Ensure billing is active (for paid providers)

### Prompt Not Loading

1. Check "Usar prompt por defecto" is checked
2. Click "Restablecer prompt" to force reload
3. Check backend logs for errors
4. Verify `default-prompts.ts` exists in backend

### Database Locked

If you see "database is locked" errors:
1. Stop all backend instances
2. Delete `catalogai.db-journal` if it exists
3. Restart backend
