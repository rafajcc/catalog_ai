# Referencia API

Referencia completa de todos los endpoints de la API de Catálogo IA.

URL base: `/api` (mismo origen). En desarrollo el backend se ejecuta en `http://localhost:3000/api`; en producción en `http://tu-dominio.com/api`, ya que el backend sirve tanto la API como el frontend.

A menos que se indique lo contrario, todos los endpoints asumen el formato de respuesta descrito en la sección de errores.

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

El campo `nonce` es obligatorio: un código de invitación de un solo uso emitido por el super
administrador (ver `GET/POST /api/auth/superadmin/nonces`). Sin un nonce válido, activo y no
caducado, el registro se rechaza y no se puede crear un nuevo comercio.

**Solicitud:**
```json
{
  "comercio_name": "Mi Negocio",
  "admin_username": "admin",
  "admin_password": "SecurePass123",
  "nonce": "ABC234XYZ789"
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
- `400` Campos faltantes, formato inválido o código de invitación inválido/usado/caducado (`error.code = INVALID_INVITATION_CODE` cuando se rechaza el código)
- `409` El nombre del negocio ya existe
- `409` El nombre de usuario ya lo usa otro comercio (o está reservado por el super administrador) — `error.code = USERNAME_TAKEN`

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
Lista todos los usuarios del negocio actual. Cada usuario expone `active` (estado activado/desactivado) y `must_change_password`.

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
      "must_change_password": false,
      "active": true,
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
- `409` El nombre de usuario ya lo está usando otro comercio (o ya existía) — `error.code = USERNAME_TAKEN`

### PUT /api/auth/users/:id
Actualiza el rol, la contraseña o el estado activado de un usuario. Cualquier usuario del negocio puede gestionarse aquí —otros administradores incluidos— salvo la cuenta en uso (para eso existe el endpoint `/api/auth/change-password`). Al fijar `password`, el usuario deberá cambiarla en su próximo inicio de sesión; al fijar `active: false` la cuenta se desactiva al instante (el usuario no podrá iniciar sesión y sus sesiones abiertas se cierran).

**Solicitud:**
```json
{
  "role": "admin",
  "password": "NewSecurePass123",
  "active": true
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
    "comercio_id": 1,
    "must_change_password": true,
    "active": true
  }
}
```

**Errores:**
- `400` No puedes gestionar tu propia cuenta por este endpoint (usa `/api/auth/change-password`)
- `404` Usuario no encontrado

### DELETE /api/auth/users/:id
Elimina un usuario. Puede eliminarse cualquier usuario del negocio, otros administradores incluidos; solo la cuenta en uso está protegida.

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
Estado y versión del backend. El campo `version` proviene del `package.json` del backend y es lo que muestra la insignia del encabezado (`v1.3.0-beta`) junto al nombre de la aplicación.

**Respuesta (200):**
```json
{
  "success": true,
  "message": "Online",
  "version": "1.3.0-beta"
}
```

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

### POST /api/autocomplete
Ejecuta el autocompletado con IA de un único producto. El proveedor de IA seleccionado propone valores solo para los campos de texto vacíos (`description_short`, `description`, `meta_title`, `meta_description`). Las imágenes de producto no se piden nunca a la IA; en la misma petición el backend las resuelve con el motor de servicios de imágenes (feed primero y luego round-robin sobre los servicios habilitados) y las devuelve por separado.

**Solicitud:**
```json
{
  "product": {
    "id": "1",
    "reference": "REF-001",
    "name": "Nombre del producto",
    "brand": "Adidas",
    "ean": "1234567890123",
    "description": "Descripción actual"
  },
  "language": "es",
  "provider": "openai"
}
```

**Respuesta (200):**
```json
{
  "success": true,
  "data": {
    "reference": "REF-001",
    "status": "success",
    "confidence": 0.9,
    "warnings": [],
    "proposals": {
      "description_short": "Descripción corta generada por IA",
      "description": "Descripción larga generada por IA...",
      "meta_title": "Título optimizado para SEO",
      "meta_description": "Meta descripción SEO"
    },
    "image_urls": ["https://img.example.com/1.jpg", "https://img.example.com/2.jpg"],
    "image_source": "feeds"
  }
}
```

- `proposals` solo contiene valores de texto no vacíos; los campos vacíos se omiten.
- `image_urls` tiene como máximo 5 URLs (`MAX_AUTOCOMPLETE_IMAGES`) y siempre se validan con una comprobación HTTP antes de devolverse.
- `image_source` es el slug del servicio que suministró las imágenes (`feeds`, `mock`, `apify`, `serpapi`, …) o `null` si no se encontró ninguna.

**Errores:**
- `400` Falta el producto, falló el proveedor de IA o su respuesta está incompleta
- `429` El comercio no tiene cuota de autocompletado, o ya ha consumido todo el límite de su periodo de facturación actual. No se llama a ningún proveedor (ni a la IA ni a las imágenes) y no se consume la llamada. Ver [Super administrador — Cuotas de autocompletado](#super-administrador---cuotas-de-autocompletado).
- `502` La respuesta de la IA no era JSON válido con la estructura esperada

**Contabilización de la cuota:**
- El límite se comprueba **antes** de llamar a cualquier proveedor, así que una petición rechazada no cuesta nada.
- Una llamada solo consume cuota cuando el proveedor de IA responde con un JSON válido cuyo `status` sea `ok`, `insufficient_data` o `contradictory_data`. Un error del proveedor, un JSON ilegible o un `status` fuera de esa lista devuelven la llamada y no escriben ninguna fila de auditoría.
- La llamada se reserva **antes** de la petición y se liquida después, de modo que varios usuarios del mismo comercio nunca pueden pasarse del límite a la vez.
- El límite cuenta solo llamadas de IA: la búsqueda de imágenes que corre en paralelo no se contabiliza.
- El super administrador (sin comercio propio) nunca consume cuota.

**Cuerpo del error (429):**
```json
{
  "success": false,
  "error": {
    "message": "AI autocomplete limit reached for the current billing period.",
    "statusCode": 429,
    "code": "autocomplete_quota_exceeded",
    "details": { "reason": "exhausted", "limit": 50, "used": 50, "remaining": 0 }
  }
}
```

`details.reason` vale `disabled` (el autocompletado no está habilitado para el comercio) o `exhausted` (se ha agotado el límite del periodo). El `code` es estable para que el frontend pueda mostrar un mensaje traducido.

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

## Super administrador — Comercios y usuarios

Solo super administrador (la cuenta `ADMIN_USER`/`ADMIN_PASSWORD` configurada por entorno). Todos los endpoints requieren el rol `superadmin`; los campos del cuerpo quedan limitados a un único comercio vía la URL.

Ruta base: `/api/auth/superadmin`

### GET /api/auth/superadmin/comercios
Lista todos los negocios con su estado activado y el número de usuarios.

**Respuesta (200):**
```json
{
  "success": true,
  "comercios": [
    { "id": 1, "name": "Mi negocio", "active": true, "user_count": 3, "created_at": "2026-01-15T10:30:00Z" }
  ]
}
```

### PUT /api/auth/superadmin/comercios/:id/active
Activa o desactiva un negocio. Un negocio desactivado bloquea futuros inicios de sesión y cierra las sesiones ya abiertas.

**Solicitud:**
```json
{ "active": false }
```

**Respuesta (200):**
```json
{ "success": true, "comercio": { "id": 1, "name": "Mi negocio", "active": false, "user_count": 3 } }
```

**Errores:**
- `404` Comercio no encontrado

### GET /api/auth/superadmin/comercios/:id/users
Lista los usuarios de un negocio. Los campos `active` y `must_change_password` se comportan igual que en el panel del administrador.

**Respuesta (200):**
```json
{
  "success": true,
  "comercio": { "id": 1, "name": "Mi negocio", "active": true },
  "users": [
    { "id": 1, "username": "admin", "role": "admin", "comercio_id": 1, "must_change_password": false, "active": true }
  ]
}
```

### POST /api/auth/superadmin/comercios/:id/users/:userId/reset-password
Restablece la contraseña de cualquier usuario de un negocio (administradores incluidos). La nueva contraseña es temporal: el usuario deberá cambiarla en su próximo inicio de sesión.

**Solicitud:**
```json
{ "newPassword": "Nueva.Pass.123" }
```

**Respuesta (200):**
```json
{ "success": true, "user": { "id": 2, "username": "juan", "role": "user", "comercio_id": 1, "must_change_password": true, "active": true } }
```

**Errores:**
- `400` Contraseña inválida o falta `newPassword`
- `404` Usuario no encontrado en este comercio

### PUT /api/auth/superadmin/comercios/:id/users/:userId/active
Activa o desactiva cualquier usuario de un negocio (administradores incluidos). Un usuario desactivado no puede iniciar sesión y sus sesiones abiertas se cierran en la siguiente petición.

**Solicitud:**
```json
{ "active": false }
```

**Respuesta (200):**
```json
{ "success": true, "user": { "id": 2, "username": "juan", "role": "user", "comercio_id": 1, "must_change_password": false, "active": false } }
```

**Errores:**
- `400` Falta `active` (booleano)
- `404` Usuario no encontrado en este comercio

## Super administrador — Códigos de invitación

Solo super administrador. Todos los endpoints requieren el rol `superadmin`. Los nonces son
códigos de invitación de un solo uso que se entregan a los nuevos negocios; el código lo genera
el servidor (alfabeto no predecible de mayúsculas + minúsculas + dígitos, sin los
caracteres confundibles 0/O/1/I/l), así que el `POST` solo elige una ventana de
caducidad.

Ruta base: `/api/auth/superadmin`

### GET /api/auth/superadmin/nonces
Lista todos los códigos de invitación, los más recientes primero. Cuando un código
se ha usado, el negocio que se registró con él se incluye como `used_by_comercio_name`.

**Respuesta (200):**
```json
{ "success": true, "nonces": [{ "id": 1, "code": "AbC234XyZ789", "expires_at": "2026-09-30T10:00:00.000Z", "active": 1, "used": 0, "used_by_comercio_id": null, "used_by_comercio_name": null, "created_by": "sysadmin", "created_at": "2026-09-24 10:00:00", "updated_at": "2026-09-24 10:00:00" }] }
```

### POST /api/auth/superadmin/nonces
Crea un nuevo nonce de un solo uso. La duración debe ser una de `12h`, `24h`, `3d` o `7d`.

**Solicitud:**
```json
{ "duration": "7d" }
```

**Respuesta (201):**
```json
{ "success": true, "nonce": { "id": 1, "code": "ABC234XYZ789", "expires_at": "2026-10-01T10:00:00.000Z", "active": 1, "used": 0, "used_by_comercio_id": null, "created_by": "sysadmin" } }
```

**Errores:**
- `400` `duration` debe ser una de 12h, 24h, 3d o 7d

### PUT /api/auth/superadmin/nonces/:id/active
Activa o desactiva un nonce sin borrarlo (por ejemplo, para bloquear un código filtrado).

**Solicitud:**
```json
{ "active": false }
```

**Respuesta (200):**
```json
{ "success": true, "nonce": { "id": 1, "code": "ABC234XYZ789", "active": 0 } }
```

**Errores:**
- `400` Falta `active` (booleano)
- `404` Código de invitación no encontrado

## Super administrador — Servicios de imágenes

Solo super administrador. Todos los endpoints requieren el rol `superadmin`. Las credenciales nunca se exponen: la lista devuelve banderas `has_*` y los campos de configuración extra (no secretos) en lugar de los valores almacenados.

Ruta base: `/api/superadmin/image-providers`

### GET /api/superadmin/image-providers
Lista todos los servicios de imágenes con su estado público.

**Respuesta (200):**
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
Actualiza un servicio. El objeto `config` se fusiona sobre la configuración almacenada: una cadena no vacía sobrescribe el valor, una cadena vacía lo deja igual y `null` lo elimina. También acepta `enabled` (no se puede habilitar un servicio no implementado), `name` y `billing_cycle_day` (entero 1–28, o `null` para desactivar la cuota).

**Solicitud:**
```json
{
  "enabled": true,
  "config": { "api_key": "nueva-clave", "actor_id": "", "max_calls_per_month": "500" },
  "billing_cycle_day": 15,
  "reset_calls": true
}
```

**Respuesta (200):**
```json
{
  "success": true,
  "data": { "...": "estado público actualizado del servicio" },
  "definitions_count": 24
}
```

### PUT /api/superadmin/image-providers/reorder
Reordena el orden de round-robin en bloque. El cuerpo debe listar exactamente una vez cada slug de servicio existente, en el orden deseado.

**Solicitud:**
```json
{ "ordered_slugs": ["feeds", "mock", "apify", "serpapi"] }
```

**Respuesta (200):**
```json
{ "success": true, "message": "4 providers reordered" }
```

### POST /api/superadmin/image-providers/:slug/reset-calls
Restablece manualmente el contador de facturación de un servicio (a su inicio de ciclo actual, según `billing_cycle_day`).

**Respuesta (200):**
```json
{ "success": true, "message": "Billing counter of apify reset" }
```

### GET /api/superadmin/image-providers/feeds
Lista las imágenes de feed (tabla fija de URL/marca/referencia/EAN). El parámetro opcional `?search=` filtra por marca, referencia o EAN. Devuelve hasta 500 filas.

**Respuesta (200):**
```json
{
  "success": true,
  "data": [
    { "id": 1, "brand": "Adidas", "reference": "REF-001", "ean": null, "image_url": "https://cdn.example.com/1.jpg" }
  ]
}
```

### POST /api/superadmin/image-providers/feeds
Añade una fila de imagen de feed. Requiere `brand` e `image_url`; `image_url` debe ser una URL absoluta `http(s)`.

**Solicitud:**
```json
{ "brand": "Adidas", "reference": "REF-001", "ean": "1234567890123", "image_url": "https://cdn.example.com/1.jpg" }
```

**Respuesta (200):**
```json
{ "success": true, "data": { "id": 1, "brand": "Adidas", "reference": "REF-001", "ean": "1234567890123", "image_url": "https://cdn.example.com/1.jpg" } }
```

### DELETE /api/superadmin/image-providers/feeds/:id
Elimina una fila de imágenes de feed.

**Respuesta (200):**
```json
{ "success": true }
```

## Super administrador — Cuotas de autocompletado

Solo super administrador. Todos los endpoints siguientes requieren el rol `superadmin`. Cada comercio tiene un límite de llamadas de autocompletado por periodo de facturación (`0` = deshabilitado, `-1` = sin límite, `N` = N llamadas por periodo) y un contador de las llamadas ya consumidas en el periodo actual. El valor por defecto es `0`, así que el autocompletado queda deshabilitado hasta que el super administrador concede una cuota.

Ruta base: `/api/superadmin/autocomplete-quota`

### GET /api/superadmin/autocomplete-quota
Lista todos los comercios con su cuota y lo que les queda del periodo. Los comercios nunca configurados también aparecen, con el valor por defecto deshabilitado.

**Respuesta (200):**
```json
{
  "success": true,
  "data": [
    {
      "comercio_id": 3,
      "comercio_name": "Tienda Uno",
      "monthly_limit": 50,
      "unlimited": false,
      "billing_cycle_day": 1,
      "calls_this_cycle": 12,
      "remaining": 38,
      "cycle_start": "2026-10-01",
      "updated_at": "2026-10-01 09:12:00"
    }
  ]
}
```

`unlimited` se deriva de `monthly_limit === -1` y `remaining` vale `null` en ese caso.

### PUT /api/superadmin/autocomplete-quota/:comercioId
Actualiza el límite y el día de inicio del ciclo de un comercio. Cambiar `billing_cycle_day` reinicia el periodo, así que el contador guardado siempre corresponde al ciclo guardado.

**Petición:**
```json
{ "monthly_limit": 50, "billing_cycle_day": 1 }
```

- `monthly_limit` es obligatorio y debe ser `-1` (sin límite), `0` (deshabilitado) o un entero positivo.
- `billing_cycle_day` es el día del mes en el que empieza el periodo (entero 1–28, por defecto `1`). El periodo es un ciclo mensual rodante anclado a ese día, la misma convención que usan los servicios de proveedores de imágenes.

**Respuesta (200):**
```json
{ "success": true, "data": { "...": "estado público actualizado de la cuota" } }
```

**Errores:**
- `400` Falta `monthly_limit` o no es uno de los valores aceptados, o `billing_cycle_day` fuera de 1–28
- `404` Comercio no encontrado

### POST /api/superadmin/autocomplete-quota/:comercioId/reset-calls
Pone a cero el contador del periodo actual sin tocar la configuración (el periodo se mantiene, así que el comercio recupera todo su límite).

**Respuesta (200):**
```json
{ "success": true, "data": { "...": "estado público actualizado de la cuota" } }
```

**Errores:**
- `404` Comercio no encontrado

### GET /api/superadmin/autocomplete-quota/audit-log
Registro de auditoría de las llamadas de autocompletado que sí se consumieron, de la más reciente a la más antigua. Ambas fechas son obligatorias y el rango no puede superar los 30 días. El endpoint devuelve las **50 más recientes** junto con el total de llamadas del rango, para que el cliente distinga una lista recortada del periodo completo (el CSV lleva siempre todas las filas).

**Parámetros de consulta:**
- `from` — Fecha inicial, `YYYY-MM-DD` (inclusive)
- `to` — Fecha final, `YYYY-MM-DD` (inclusive, como máximo 30 días después de `from`)
- `comercio_id` — Opcional; limita el informe a un comercio

**Respuesta (200):**
```json
{
  "success": true,
  "data": {
    "rows": [
      {
        "id": 42,
        "comercio_id": 3,
        "comercio_name": "Tienda Uno",
        "user_id": 7,
        "user_name": "juan",
        "ai_provider_id": 2,
        "ai_provider_name": "openai",
        "status": "ok",
        "product_brand": "Adidas",
        "product_reference": "REF-001",
        "product_ean": "1234567890123",
        "requested_at": "2026-10-02 09:12:00"
      }
    ],
    "total": 137,
    "limit": 50
  }
}
```

`total` cuenta todas las llamadas consumidas del rango (no solo las devueltas), así que `rows.length < total` significa que hay llamadas más antiguas que no están en pantalla. No hay paginación: acorta el rango o filtra por comercio para ver filas anteriores, o descarga el CSV.

`comercio_name` y `user_name` se resuelven con `LEFT JOIN`, así que el informe se lee en nombres y no en ids. Valen `null` si el comercio o el usuario se borraron después de la llamada (los ids están siempre como respaldo).

**Errores:**
- `400` Faltan `from`/`to`, no son fechas reales en formato `YYYY-MM-DD`, `to` es anterior a `from` o el rango supera los 30 días
- `404` El `comercio_id` solicitado no existe

### GET /api/superadmin/autocomplete-quota/audit-log.csv
El mismo informe en formato CSV, con los mismos parámetros de consulta. Todos los valores van entre comillas (con las comillas internas duplicadas) y el archivo empieza por un BOM UTF-8 para que Excel muestre correctamente las marcas con acentos. Se descarga como adjunto con el nombre `autocomplete-audit-<comercio|all>-<from>-<to>.csv`.

Columnas: `comercio_id, comercio_name, user_id, user_name, ai_provider_id, ai_provider_name, status, brand, reference, ean, requested_at`.

Cada id viaja junto a su nombre, así que el fichero se puede leer (y unir con otras tablas) sin tener que averiguar qué significa un `3` o un `7`. `comercio_name` y `user_name` van vacíos si el comercio o el usuario ya no existen.

**Errores:** los mismos que en `GET /api/superadmin/autocomplete-quota/audit-log`.

## Respuestas de error

Todas las respuestas de error siguen este formato:

```json
{
  "success": false,
  "error": {
    "message": "Mensaje de error",
    "statusCode": 400,
    "code": "CODIGO_DE_ERROR_ESTABLE",
    "details": { }
  }
}
```

`code` y `details` solo aparecen cuando el código que lanzó el error los ha fijado (por ejemplo la cuota de autocompletado respondiendo `429` con `code: "autocomplete_quota_exceeded"`), para que el cliente pueda distinguir dos casos del mismo estado sin analizar el mensaje.

Códigos de estado HTTP comunes:
- `400` Solicitud incorrecta / error de validación
- `401` No autorizado (token faltante o inválido)
- `403` Prohibido (permisos insuficientes)
- `404` Recurso no encontrado
- `409` Conflicto (entrada duplicada)
- `429` Demasiadas solicitudes (cuenta bloqueada o cuota de autocompletado agotada)
- `500` Error interno del servidor
