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
| **GPT4All** | Local models | No |
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

2. **BÚSQUEDA DE IMÁGENES** (Image Search)
   - Search for product images
   - Dynamic count based on current images
   - Return exact number of URLs requested

3. **Response Format**
   - Structured JSON with specific fields
   - Image URLs in dedicated array
   - SEO-optimized meta fields

## Marketplace Configuration

### Supported Marketplaces

| Marketplace | Status |
|---|---|
| **PrestaShop** | Supported |
| **WooCommerce** | Planned |
| **Shopify** | Planned |

## Security

### API Key Storage

PrestaShop and AI provider API keys are stored in the SQLite database (`ai_provider_config` / `marketplace_config`) and are never exposed in API responses (masked as `XXXX...XXXX`).

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

### Location

Stored in the data directory as `catalogai.db`:

- The path is `<DATA_DIR>/catalogai.db`.
- Default: the directory of the compiled entry point (`backend/dist/`). **Set `DATA_DIR`** in production to a writable directory.
- In local development (backend `npm run dev`), the default is the backend directory itself.

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

The database uses idempotent `CREATE TABLE IF NOT EXISTS` — it is never deleted or recreated on startup. Current schema version: 3.

**Tables:**
- `users` - User accounts
- `comercios` - Businesses
- `marketplaces` - Marketplace definitions (global)
- `ai_providers` - AI provider definitions (global)
- `comercio_marketplaces` - Business-marketplace mapping
- `comercio_ai_providers` - Business-AI provider mapping
- `comercio_configs` - Business configurations
- `app_settings` - Application settings

## Environment Variables

### Backend (.env)

A template is provided at `.env.example` (project root).

| Variable | Required | Default | Description |
|---|---|---|---|
| `NODE_ENV` | prod | — | `production` disables CORS, serves the built frontend and hides verbose errors |
| `JWT_SECRET` | prod | dev placeholder | Signs access tokens |
| `JWT_REFRESH_SECRET` | prod | dev placeholder | Signs refresh tokens |
| `DATA_DIR` | prod | entry-point dir | Writable directory where `catalogai.db` is stored |
| `PORT` | — | `3000` | HTTP port |
| `LOG_LEVEL` | — | `info` | Logging level (`debug`, `info`, `warn`, `error`) |
| `FRONTEND_URL` | — | `http://localhost:5173` | CORS origin (development only) |
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
