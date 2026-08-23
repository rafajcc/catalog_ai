# Referencia API

Referencia completa de todos los endpoints de la API de Catálogo IA.

URL base: `http://localhost:3000/api`

## Autenticación

Todos los endpoints autenticados requieren un token JWT válido en cookies httpOnly (`access_token` + `refresh_token`).

### POST /api/auth/login
Inicia sesión con nombre de usuario y contraseña. El negocio (comercio) se deriva de la cuenta del usuario.

**Solicitud:**
```json
{
  "username": "admin",
  "password": "SecurePass123"
}
```

**Respuesta (200):**
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

**Errores:**
- `400` Falta el nombre de usuario o la contraseña
- `401` Credenciales inválidas
- `429` Cuenta bloqueada (demasiados intentos fallidos)

### POST /api/auth/register-comercio
Registra un nuevo negocio con su usuario administrador. Endpoint público (flujo de primera ejecución).

**Solicitud:**
```json
{
  "comercio_name": "Mi Negocio",
  "admin_username": "admin",
  "admin_password": "SecurePass123"
}
```

**Respuesta (201):**
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

**Errores:**
- `400` Campos faltantes o formato inválido
- `409` El nombre del negocio ya existe

### POST /api/auth/logout
Limpia las cookies JWT.

**Respuesta (200):**
```json
{ "success": true }
```

### POST /api/auth/refresh
Actualiza los tokens JWT usando la cookie de token de actualización.

**Respuesta (200):**
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
Obtiene el usuario autenticado actual y la información del negocio.

**Respuesta (200):**
```json
{
  "success": true,
  "user": {
    "id": 1,
    "username": "admin",
    "role": "admin",
    "comercio_id": 1,
    "comercio_name": "Mi Negocio"
  }
}
```

## Gestión de usuarios (solo administradores)

### GET /api/auth/users
Lista todos los usuarios del negocio actual.

**Respuesta (200):**
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
Crea un nuevo usuario en el negocio actual.

**Solicitud:**
```json
{
  "username": "nuevousuario",
  "password": "SecurePass123",
  "role": "user"
}
```

**Respuesta (201):**
```json
{
  "success": true,
  "user": {
    "id": 2,
    "username": "nuevousuario",
    "role": "user",
    "comercio_id": 1
  }
}
```

**Errores:**
- `400` Nombre de usuario o contraseña inválidos
- `409` El nombre de usuario ya existe en este negocio

### PUT /api/auth/users/:id
Actualiza el rol o la contraseña de un usuario.

**Solicitud:**
```json
{
  "role": "admin",
  "password": "NewSecurePass123"
}
```

**Respuesta (200):**
```json
{
  "success": true,
  "user": {
    "id": 2,
    "username": "nuevousuario",
    "role": "admin",
    "comercio_id": 1
  }
}
```

### DELETE /api/auth/users/:id
Elimina un usuario. No puedes eliminar tu propia cuenta.

**Respuesta (200):**
```json
{ "success": true }
```

**Errores:**
- `400` No puedes eliminar tu propia cuenta
- `404` Usuario no encontrado

### PUT /api/auth/change-password
Cambia la contraseña del usuario actual.

**Solicitud:**
```json
{
  "currentPassword": "OldPass123",
  "newPassword": "NewSecurePass123"
}
```

**Respuesta (200):**
```json
{ "success": true }
```

## Configuración y estado

### GET /api/health
Verificación de salud del backend.

**Respuesta (200):**
```json
{ "status": "ok" }
```

### GET /api/status
Estado del backend (alias de health).

### GET /api/logs
Lee los registros recientes del backend.

**Respuesta (200):**
```json
{
  "success": true,
  "logs": ["[INFO] Servidor iniciado", "..."]
}
```

### GET /api/config
Lee la configuración actual. Las claves de API están enmascaradas.

**Respuesta (200):**
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
Actualiza la configuración (solo administradores). Se fusiona con la configuración existente.

**Solicitud:**
```json
{
  "marketplace": "PrestaShop",
  "prestashop": {
    "base_url": "https://shop.example.com",
    "api_key": "tu-api-key"
  },
  "ai": {
    "provider": "openai",
    "model": "gpt-4",
    "api_key": "tu-api-key"
  }
}
```

**Respuesta (200):**
```json
{ "success": true }
```

### POST /api/config/test/prestashop
Prueba la conexión con el Webservice de PrestaShop.

**Respuesta (200):**
```json
{ "success": true, "message": "Conexión exitosa" }
```

### POST /api/config/test/ai
Prueba la conexión con el proveedor de IA.

**Respuesta (200):**
```json
{ "success": true, "message": "Conexión exitosa" }
```

### POST /api/config/reset-prompt
Restaura el prompt de IA predeterminado del sistema.

**Respuesta (200):**
```json
{ "success": true }
```

## Importación de productos (PrestaShop)

### POST /api/fetch/prestashop
Obtiene productos de PrestaShop por referencia/marca con filtros.

**Solicitud:**
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

**Respuesta (200):**
```json
{
  "success": true,
  "count": 2,
  "products": [...]
}
```

### GET /api/fetch/prestashop
Obtiene el dataset de PrestaShop obtenido.

**Respuesta (200):**
```json
{
  "success": true,
  "count": 2,
  "products": [...]
}
```

### DELETE /api/fetch/prestashop
Descarta el dataset de PrestaShop obtenido.

**Respuesta (200):**
```json
{ "success": true }
```

### POST /api/fetch/prestashop/save
Envía los campos de producto editados de vuelta a PrestaShop. Solo se envían los campos modificados.

**Solicitud:**
```json
{
  "products": [
    {
      "id": 1,
      "reference": "REF-001",
      "name": "Nombre de producto actualizado",
      "description_short": "Descripción corta actualizada"
    }
  ]
}
```

**Respuesta (200):**
```json
{
  "success": true,
  "saved": 1
}
```

### GET /api/images/proxy
Proxy de una imagen desde una URL externa (evita CORS + caché).

**Parámetros de consulta:**
- `url` — La URL de la imagen a proxificar

**Respuesta:** Bytes de imagen con el encabezado Content-Type apropiado.

**Errores:**
- `400` Falta el parámetro URL
- `408` Tiempo de espera agotado (15s)
- `502` Error al obtener la imagen

## Autocompletado con IA

### POST /api/ai/autocomplete
Ejecuta el autocompletado con IA en los productos seleccionados.

**Solicitud:**
```json
{
  "products": [
    {
      "id": "1",
      "reference": "REF-001",
      "name": "Nombre del producto",
      "description": "Descripción actual"
    }
  ],
  "fields": ["name", "description", "meta_title", "meta_description", "image_urls"]
}
```

**Respuesta (200):**
```json
{
  "success": true,
  "results": [
    {
      "id": "1",
      "proposal": {
        "name": "Nombre mejorado del producto",
        "description": "Descripción generada por IA...",
        "meta_title": "Título optimizado para SEO",
        "meta_description": "Meta descripción SEO",
        "image_urls": ["https://..."]
      }
    }
  ]
}
```

### GET /api/config/default-prompt
Obtiene el prompt de IA predeterminado para el idioma actual.

**Parámetros de consulta:**
- `lang` — Código de idioma (`es` o `en`)

**Respuesta (200):**
```json
{
  "success": true,
  "prompt": "BÚSQUEDA WEB OBLIGATORIA: ..."
}
```

## Respuestas de error

Todas las respuestas de error siguen este formato:

```json
{
  "success": false,
  "error": "Mensaje de error"
}
```

Códigos de estado HTTP comunes:
- `400` Solicitud incorrecta / error de validación
- `401` No autorizado (token faltante o inválido)
- `403` Prohibido (permisos insuficientes)
- `404` Recurso no encontrado
- `409` Conflicto (entrada duplicada)
- `429` Demasiadas solicitudes (cuenta bloqueada)
- `500` Error interno del servidor
