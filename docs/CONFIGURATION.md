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

### API Key Encryption

All API keys are encrypted at rest using AES-256-GCM:
- Encryption key: `CONFIG_SECRET` environment variable
- Auto-generated if not set (stored in `config.json.key`)
- Never exposed in API responses (masked as `XXXX...XXXX`)

### JWT Tokens

- **Access token**: Short-lived (15 minutes)
- **Refresh token**: Long-lived (7 days)
- **Storage**: httpOnly cookies (not accessible via JavaScript)
- **Signing**: HS256 with `JWT_SECRET`

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

Default: `backend/catalogai.db`

### Backup

```bash
cp backend/catalogai.db backup/catalogai_$(date +%Y%m%d).db
```

### Reset

```bash
rm backend/catalogai.db
rm backend/config.json.key  # optional
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

```bash
# Server
PORT=3000
NODE_ENV=development

# CORS
FRONTEND_URL=http://localhost:5173

# Security (auto-generated if not set)
JWT_SECRET=your-jwt-secret
CONFIG_SECRET=your-config-secret

# Database
DATA_DIR=.
```

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
4. Check `backend/catalogai.db` exists and is writable

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
