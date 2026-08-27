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

**Request:**
```json
{
  "comercio_name": "My Business",
  "admin_username": "admin",
  "admin_password": "SecurePass123"
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
- `400` Missing fields or invalid format
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
List all users in the current business.

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
Update a user's role or password.

**Request:**
```json
{
  "role": "admin",
  "password": "NewSecurePass123"
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
    "comercio_id": 1
  }
}
```

### DELETE /api/auth/users/:id
Delete a user. Cannot delete your own account.

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
Backend status (alias for health).

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

### POST /api/ai/autocomplete
Run AI autocomplete on selected products.

**Request:**
```json
{
  "products": [
    {
      "id": "1",
      "reference": "REF-001",
      "name": "Product Name",
      "description": "Current description"
    }
  ],
  "fields": ["name", "description", "meta_title", "meta_description", "image_urls"]
}
```

**Response (200):**
```json
{
  "success": true,
  "results": [
    {
      "id": "1",
      "proposal": {
        "name": "Enhanced Product Name",
        "description": "AI-generated description...",
        "meta_title": "SEO-optimized title",
        "meta_description": "SEO meta description",
        "image_urls": ["https://..."]
      }
    }
  ]
}
```

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
