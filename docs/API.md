# API Reference

Complete reference for all Catalog AI API endpoints.

Base URL: `/api` (same-origin). In development the backend runs at `http://localhost:3000/api`; in production `http://your-domain.com/api`, since the backend serves both the API and the frontend.

The following endpoints assume the version field returned by `GET /api/status`.

## Authentication

All authenticated endpoints require a valid JWT token in httpOnly cookies (`access_token` + `refresh_token`).

### POST /api/auth/login
Log in with username and password. The business (comercio) is derived from the user's account.

**Request:**
```json
{
  "username": "admin",
  "password": "SecurePass123"
}
```

**Response (200):**
```json
{
  "success": true,
  "user": {
    "id": 1,
    "username": "admin",
    "role": "admin",
    "comercio_id": 1
  }
}
```

**Errors:**
- `400` Missing username or password
- `401` Invalid credentials
- `429` Account locked (too many failed attempts)

### POST /api/auth/register-comercio
Register a new business with its admin user. Public endpoint (first-run flow).

The `nonce` field is mandatory: a single-use invitation code minted by the super
admin (see `GET/POST /api/auth/superadmin/nonces`). Without a valid, active,
unexpired nonce the registration is rejected and a new commerce cannot be created.

**Request:**
```json
{
  "comercio_name": "My Business",
  "admin_username": "admin",
  "admin_password": "SecurePass123",
  "nonce": "ABC234XYZ789"
}
```

**Response (201):**
```json
{
  "success": true,
  "user": {
    "id": 1,
    "username": "admin",
    "role": "admin",
    "comercio_id": 1
  }
}
```

**Errors:**
- `400` Missing fields, invalid format, or invalid/used/expired registration nonce
- `409` Business name already exists

### POST /api/auth/logout
Clear JWT cookies.

**Response (200):**
```json
{ "success": true }
```

### POST /api/auth/refresh
Refresh JWT tokens using the refresh token cookie.

**Response (200):**
```json
{
  "success": true,
  "user": {
    "id": 1,
    "username": "admin",
    "role": "admin",
    "comercio_id": 1
  }
}
```

### GET /api/auth/me
Get the current authenticated user and business info.

**Response (200):**
```json
{
  "success": true,
  "user": {
    "id": 1,
    "username": "admin",
    "role": "admin",
    "comercio_id": 1,
    "comercio_name": "My Business"
  }
}
```

## User Management (Admin Only)

### GET /api/auth/users
List all users in the current business. Every user exposes `active` (enabled/disabled state) and `must_change_password`.

**Response (200):**
```json
{
  "success": true,
  "users": [
    {
      "id": 1,
      "username": "admin",
      "role": "admin",
      "comercio_id": 1,
      "must_change_password": false,
      "active": true,
      "created_at": "2026-01-15T10:30:00Z"
    }
  ]
}
```

### POST /api/auth/users
Create a new user in the current business.

**Request:**
```json
{
  "username": "newuser",
  "password": "SecurePass123",
  "role": "user"
}
```

**Response (201):**
```json
{
  "success": true,
  "user": {
    "id": 2,
    "username": "newuser",
    "role": "user",
    "comercio_id": 1
  }
}
```

**Errors:**
- `400` Invalid username or password
- `409` Username already exists in this business

### PUT /api/auth/users/:id
Update a user's role, password or enabled state. Every user of the business can be managed here — other admins included — except the account currently in use (a dedicated `/api/auth/change-password` endpoint exists for that). Setting `password` marks the user to change it on the next login; setting `active: false` disables the account immediately (the user cannot log in and its open sessions are killed).

**Request:**
```json
{
  "role": "admin",
  "password": "NewSecurePass123",
  "active": true
}
```

**Response (200):**
```json
{
  "success": true,
  "user": {
    "id": 2,
    "username": "newuser",
    "role": "admin",
    "comercio_id": 1,
    "must_change_password": true,
    "active": true
  }
}
```

**Errors:**
- `400` Cannot manage your own account through this endpoint (use `/api/auth/change-password`)
- `404` User not found

### DELETE /api/auth/users/:id
Delete a user. Any user of the business can be deleted, other admins included — only the account currently in use is protected.

**Response (200):**
```json
{ "success": true }
```

**Errors:**
- `400` Cannot delete your own account
- `404` User not found

### PUT /api/auth/change-password
Change the current user's password.

**Request:**
```json
{
  "currentPassword": "OldPass123",
  "newPassword": "NewSecurePass123"
}
```

**Response (200):**
```json
{ "success": true }
```

## Configuration & Health

### GET /api/health
Backend health check.

**Response (200):**
```json
{ "status": "ok" }
```

### GET /api/status
Backend health and version. The `version` field comes from the backend `package.json` and is what the header badge (`v1.2.2`) displays next to the app name.

**Response (200):**
```json
{
  "success": true,
  "message": "Online",
  "version": "1.2.2"
}
```

### GET /api/logs
Read recent backend logs.

**Response (200):**
```json
{
  "success": true,
  "logs": ["[INFO] Server started", "..."]
}
```

### GET /api/config
Read the current configuration. API keys are masked.

**Response (200):**
```json
{
  "success": true,
  "config": {
    "marketplace": "PrestaShop",
    "prestashop": {
      "base_url": "https://shop.example.com",
      "api_key": "XXXX...XXXX",
      "version": "8.1.0",
      "language_id": 1
    },
    "ai": {
      "provider": "openai",
      "base_url": "https://api.openai.com",
      "model": "gpt-4",
      "api_key": "sk-...XXX",
      "language": "es",
      "default_prompt": "..."
    }
  }
}
```

### PUT /api/config
Update configuration (admin only). Merges with existing config.

**Request:**
```json
{
  "marketplace": "PrestaShop",
  "prestashop": {
    "base_url": "https://shop.example.com",
    "api_key": "your-api-key"
  },
  "ai": {
    "provider": "openai",
    "model": "gpt-4",
    "api_key": "your-api-key"
  }
}
```

**Response (200):**
```json
{ "success": true }
```

### POST /api/config/test/prestashop
Test the PrestaShop Webservice connection.

**Response (200):**
```json
{ "success": true, "message": "Connection successful" }
```

### POST /api/config/test/ai
Test the AI provider connection.

**Response (200):**
```json
{ "success": true, "message": "Connection successful" }
```

### POST /api/config/reset-prompt
Restore the system default AI prompt.

**Response (200):**
```json
{ "success": true }
```

## Product Import (PrestaShop)

### POST /api/fetch/prestashop
Fetch products from PrestaShop by reference/brand with filters.

**Request:**
```json
{
  "references": "REF-001, REF-002",
  "brand": "Adidas",
  "description_filter": "with",
  "images_filter": "all",
  "filter_operator": "and",
  "limit": 100
}
```

**Response (200):**
```json
{
  "success": true,
  "count": 2,
  "products": [...]
}
```

### GET /api/fetch/prestashop
Get the fetched PrestaShop dataset.

**Response (200):**
```json
{
  "success": true,
  "count": 2,
  "products": [...]
}
```

### DELETE /api/fetch/prestashop
Discard the fetched PrestaShop dataset.

**Response (200):**
```json
{ "success": true }
```

### POST /api/fetch/prestashop/save
Push edited product fields back to PrestaShop. Only changed fields are sent.

**Request:**
```json
{
  "products": [
    {
      "id": 1,
      "reference": "REF-001",
      "name": "Updated Product Name",
      "description_short": "Updated short description"
    }
  ]
}
```

**Response (200):**
```json
{
  "success": true,
  "saved": 1
}
```

### GET /api/images/proxy
Proxy an image from an external URL (CORS bypass + caching).

**Query Parameters:**
- `url` - The image URL to proxy

**Response:** Image bytes with appropriate Content-Type header.

**Errors:**
- `400` Missing URL parameter
- `408` Request timeout (15s)
- `502` Failed to fetch image

## AI Autocomplete

### POST /api/autocomplete
Run AI autocomplete on one product. The selected AI provider proposes values for the empty text fields only (`description_short`, `description`, `meta_title`, `meta_description`). Product images are never requested from the AI; in the same request the backend resolves them with the image-provider engine (feeds first, then round-robin over the enabled services) and returns them separately.

**Request:**
```json
{
  "product": {
    "id": "1",
    "reference": "REF-001",
    "name": "Product Name",
    "brand": "Adidas",
    "ean": "1234567890123",
    "description": "Current description"
  },
  "language": "es",
  "provider": "openai"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "reference": "REF-001",
    "status": "success",
    "confidence": 0.9,
    "warnings": [],
    "proposals": {
      "description_short": "AI-generated short description",
      "description": "AI-generated long description...",
      "meta_title": "SEO-optimized title",
      "meta_description": "SEO meta description"
    },
    "image_urls": ["https://img.example.com/1.jpg", "https://img.example.com/2.jpg"],
    "image_source": "feeds"
  }
}
```

- `proposals` only contains non-empty text values; empty fields are omitted.
- `image_urls` is capped at 5 URLs (`MAX_AUTOCOMPLETE_IMAGES`) and always validated with an HTTP check before being returned.
- `image_source` is the slug of the service that supplied the images (`feeds`, `mock`, `apify`, `serpapi`, …) or `null` when no image was found.

**Errors:**
- `400` Missing product, AI provider failed, or partial/missing provider answer
- `502` The AI response was not valid JSON matching the expected structure

### GET /api/config/default-prompt
Get the default AI prompt for the current language.

**Query Parameters:**
- `lang` - Language code (`es` or `en`)

**Response (200):**
```json
{
  "success": true,
  "prompt": "BÚSQUEDA WEB OBLIGATORIA: ..."
}
```

## Super Admin — Comercios & Users

Super admin only (the env-configured `ADMIN_USER`/`ADMIN_PASSWORD` account). All endpoints below require the `superadmin` role; body fields are scoped to a single comercio via the URL.

Base path: `/api/auth/superadmin`

### GET /api/auth/superadmin/comercios
List every business with its enabled state and user count.

**Response (200):**
```json
{
  "success": true,
  "comercios": [
    { "id": 1, "name": "My Business", "active": true, "user_count": 3, "created_at": "2026-01-15T10:30:00Z" }
  ]
}
```

### PUT /api/auth/superadmin/comercios/:id/active
Enable or disable a business. A disabled business blocks future logins and kills the sessions already open.

**Request:**
```json
{ "active": false }
```

**Response (200):**
```json
{ "success": true, "comercio": { "id": 1, "name": "My Business", "active": false, "user_count": 3 } }
```

**Errors:**
- `404` Comercio not found

### GET /api/auth/superadmin/comercios/:id/users
List the users of one business. The `active` and `must_change_password` fields behave exactly as in the admin panel.

**Response (200):**
```json
{
  "success": true,
  "comercio": { "id": 1, "name": "My Business", "active": true },
  "users": [
    { "id": 1, "username": "admin", "role": "admin", "comercio_id": 1, "must_change_password": false, "active": true }
  ]
}
```

### POST /api/auth/superadmin/comercios/:id/users/:userId/reset-password
Reset the password of any user of a business (admins included). The new password is temporary: the user must change it on its next login.

**Request:**
```json
{ "newPassword": "Fresh.Pass.123" }
```

**Response (200):**
```json
{ "success": true, "user": { "id": 2, "username": "juan", "role": "user", "comercio_id": 1, "must_change_password": true, "active": true } }
```

**Errors:**
- `400` Invalid password or missing `newPassword`
- `404` User not found in this comercio

### PUT /api/auth/superadmin/comercios/:id/users/:userId/active
Enable or disable any user of a business (admins included). A disabled user cannot log in and its open sessions are killed on the next request.

**Request:**
```json
{ "active": false }
```

**Response (200):**
```json
{ "success": true, "user": { "id": 2, "username": "juan", "role": "user", "comercio_id": 1, "must_change_password": false, "active": false } }
```

**Errors:**
- `400` Missing `active` (boolean)
- `404` User not found in this comercio

## Super Admin — Registration Nonces

Super admin only. All endpoints below require the `superadmin` role. Nonces are
single-use invitation codes handed out to new businesses; the code is generated
server-side (a non-guessable alphabet without 0/O/1/I/L) so the `POST` only picks
an expiry window.

Base path: `/api/auth/superadmin`

### GET /api/auth/superadmin/nonces
List every registration nonce, newest first.

**Response (200):**
```json
{ "success": true, "nonces": [{ "id": 1, "code": "ABC234XYZ789", "expires_at": "2026-09-30T10:00:00.000Z", "active": 1, "used": 0, "used_by_comercio_id": null, "created_by": "sysadmin", "created_at": "2026-09-24 10:00:00", "updated_at": "2026-09-24 10:00:00" }] }
```

### POST /api/auth/superadmin/nonces
Create a new single-use nonce. The duration must be one of `12h`, `24h`, `3d` or `7d`.

**Request:**
```json
{ "duration": "7d" }
```

**Response (201):**
```json
{ "success": true, "nonce": { "id": 1, "code": "ABC234XYZ789", "expires_at": "2026-10-01T10:00:00.000Z", "active": 1, "used": 0, "used_by_comercio_id": null, "created_by": "sysadmin" } }
```

**Errors:**
- `400` `duration` must be one of 12h, 24h, 3d or 7d

### PUT /api/auth/superadmin/nonces/:id/active
Flip a nonce on/off without deleting it (e.g. to block a leaked code instantly).

**Request:**
```json
{ "active": false }
```

**Response (200):**
```json
{ "success": true, "nonce": { "id": 1, "code": "ABC234XYZ789", "active": 0 } }
```

**Errors:**
- `400` `active` (boolean) is required
- `404` Registration nonce not found

## Super Admin — Image Providers

Super admin only. All endpoints below require the `superadmin` role. Credentials are never exposed: the list returns `has_*` flags plus the extra (non-secret) config fields instead of the stored values.

Base path: `/api/superadmin/image-providers`

### GET /api/superadmin/image-providers
List every image provider service with its public state.

**Response (200):**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "slug": "apify",
      "name": "Apify",
      "enabled": false,
      "sort_order": 1,
      "implemented": true,
      "auth_kind": "api_key",
      "has_api_key": true,
      "has_username": false,
      "has_password": false,
      "max_calls_per_month": "1000",
      "extra_config": [{ "key": "actor_id", "label": "Actor ID (p. ej. apify/google-images-scraper)", "configured": false }],
      "calls_this_cycle": 12,
      "billing_cycle_day": 1,
      "cycle_start": "2026-09-01",
      "last_called": false
    }
  ]
}
```

### PUT /api/superadmin/image-providers/:slug
Update one provider. The `config` object is merged over the stored config: a non-empty string overwrites the value, an empty string leaves it unchanged, `null` deletes it. Also accepts `enabled` (cannot enable a not-implemented service), `name`, and `billing_cycle_day` (integer 1–28, or `null` to disable quotas).

**Request:**
```json
{
  "enabled": true,
  "config": { "api_key": "new-key", "actor_id": "", "max_calls_per_month": "500" },
  "billing_cycle_day": 15,
  "reset_calls": true
}
```

**Response (200):**
```json
{
  "success": true,
  "data": { "...": "fresh public provider state" },
  "definitions_count": 24
}
```

### PUT /api/superadmin/image-providers/reorder
Batch reorder of the round-robin order. The body must list every existing provider slug exactly once, in the desired order.

**Request:**
```json
{ "ordered_slugs": ["feeds", "mock", "apify", "serpapi"] }
```

**Response (200):**
```json
{ "success": true, "message": "4 providers reordered" }
```

### POST /api/superadmin/image-providers/:slug/reset-calls
Manually reset the billing counter of a provider (to its current cycle start, based on `billing_cycle_day`).

**Response (200):**
```json
{ "success": true, "message": "Billing counter of apify reset" }
```

### GET /api/superadmin/image-providers/feeds
List the feed images (fixed URL/brand/reference/EAN table). Optional `?search=` filters by brand, reference or EAN. Returns up to 500 rows.

**Response (200):**
```json
{
  "success": true,
  "data": [
    { "id": 1, "brand": "Adidas", "reference": "REF-001", "ean": null, "image_url": "https://cdn.example.com/1.jpg" }
  ]
}
```

### POST /api/superadmin/image-providers/feeds
Add a feed image row. `brand` and `image_url` are required; `image_url` must be an absolute `http(s)` URL.

**Request:**
```json
{ "brand": "Adidas", "reference": "REF-001", "ean": "1234567890123", "image_url": "https://cdn.example.com/1.jpg" }
```

**Response (200):**
```json
{ "success": true, "data": { "id": 1, "brand": "Adidas", "reference": "REF-001", "ean": "1234567890123", "image_url": "https://cdn.example.com/1.jpg" } }
```

### DELETE /api/superadmin/image-providers/feeds/:id
Remove a feed image row.

**Response (200):**
```json
{ "success": true }
```

## Error Responses

All error responses follow this format:

```json
{
  "success": false,
  "error": "Error message"
}
```

Common HTTP status codes:
- `400` Bad request / validation error
- `401` Unauthorized (missing or invalid token)
- `403` Forbidden (insufficient permissions)
- `404` Resource not found
- `409` Conflict (duplicate entry)
- `429` Too many requests (account locked)
- `500` Internal server error
