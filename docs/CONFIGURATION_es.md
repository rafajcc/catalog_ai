# Configuración

Referencia detallada de configuración de Catálogo IA.

## Visión general

La configuración es por negocio ("comercio"). Cada negocio tiene sus propias configuraciones aisladas almacenadas en la base de datos SQLite.

## Acceso a la configuración

- **Usuarios administradores**: Acceso completo (lectura/escritura)
- **Usuarios normales**: Acceso de solo lectura

Haz clic en el ícono de configuración (⚙) en el encabezado para abrir el panel de configuración.

## Configuración de PrestaShop

### Campos requeridos

| Campo | Descripción | Ejemplo |
|---|---|---|
| **URL base** | La URL de tu tienda PrestaShop | `https://shop.example.com` |
| **Clave API** | Clave API del Webservice de PrestaShop | `BCDEFGH12345...` |

### Campos opcionales

| Campo | Descripción | Predeterminado |
|---|---|---|
| **Versión** | Versión de PrestaShop | `8.1.0` |
| **ID de idioma** | Idioma predeterminado para los datos de productos | `1` (Inglés) |

### Obtener tu clave API

1. Inicia sesión en el admin de PrestaShop
2. Ve a **Parámetros avanzados > Webservice**
3. Haz clic en **Agregar nueva clave de webservice**
4. Selecciona recursos: `products` (lectura), `products` (escritura)
5. Copia la clave generada

### Prueba de conexión

Haz clic en "Probar conexión PrestaShop" para verificar:
- La URL es accesible
- La clave API es válida
- La API Webservice está habilitada

## Configuración del proveedor de IA

### Proveedores disponibles

| Proveedor | Descripción | Clave API requerida |
|---|---|---|
| **OpenAI** | GPT-4, GPT-3.5 | Sí |
| **Anthropic** | Claude | Sí |
| **OpenRouter** | Gateway multi-proveedor | Sí |
| **Mock** | Pruebas (sin IA real) | No |

### Campos requeridos

| Campo | Descripción | Ejemplo |
|---|---|---|
| **Proveedor** | Seleccionar del menú desplegable | `openai` |
| **Modelo** | Nombre del modelo | `gpt-4` |
| **Clave API** | Clave API del proveedor | `sk-...` |

### Campos opcionales

| Campo | Descripción | Predeterminado |
|---|---|---|
| **URL base** | Endpoint API personalizado | Predeterminado del proveedor |
| **Idioma** | Idioma de respuesta | `es` (Español) |
| **Temperatura** | Creatividad (0-1) | `0.7` |
| **Timeout** | Tiempo de espera de la petición en segundos. Vacío = predeterminado | `30` segundos |
| **Concurrencia** | Máximo de llamadas IA en paralelo durante autocompletado (1–50). Vacío = predeterminado | `5` llamadas |

### Prueba de conexión

Haz clic en "Probar conexión IA" para verificar:
- La clave API es válida
- El modelo es accesible
- El proveedor responde correctamente

## Configuración del prompt de IA

### Prompt predeterminado

El sistema incluye un prompt predeterminado optimizado para:
- Búsqueda web obligatoria de datos de productos
- Búsqueda de imágenes con inyección dinámica de cantidad
- Formato de respuesta JSON estructurado

### Usar prompt predeterminado

Marca "Usar prompt por defecto" para:
- Cargar automáticamente el prompt predeterminado del sistema
- Recibir actualizaciones cuando se mejore el prompt
- Restablecer en cualquier momento

### Prompt personalizado

Desmarca "Usar prompt por defecto" para editar el prompt manualmente.

**Advertencia:** Los prompts personalizados se sobreescribirán si vuelves a habilitar el prompt predeterminado.

### Restablecer a predeterminado

Haz clic en "Restablecer prompt" para restaurar el predeterminado del sistema.

### Estructura del prompt

El prompt predeterminado incluye:

1. **BÚSQUEDA WEB OBLIGATORIA**
   - Siempre buscar información real del producto
   - Verificar especificaciones y características
   - Encontrar descripciones precisas

2. **Formato de respuesta**
   - JSON estructurado con campos de texto específicos
   - Campos meta optimizados para SEO
   - La IA solo rellena los campos de texto vacíos (`description_short`, `description`, `meta_title`, `meta_description`). Las imágenes de producto nunca salen de la IA — las resuelve el motor de servicios de imágenes (consulta *Servicios de imágenes* abajo).

## Servicios de imágenes

Las imágenes de producto del autocompletado las resuelven los servicios de imágenes, **no la IA**. El super administrador los configura desde el panel **Servicios de imágenes** (solo lo ve el super administrador).

### Cómo se usan

1. **Feeds primero.** El servicio `feeds` (habilitado por defecto) cruza la marca/referencia/EAN del producto con la tabla `provider_feed_images`. Es gratuito, no consume cupo de facturación y se prueba antes que el resto.
2. **Round-robin.** Los demás servicios habilitados se llaman en orden (`sort_order`), uno por búsqueda de producto, empezando siempre después del servicio que hizo la última llamada real.
3. **Facturación.** Cada servicio tiene un cupo opcional `max_calls_per_month` y un `billing_cycle_day`; el contador se reinicia automáticamente al pasar el día del ciclo. Los servicios sin clave configurada, sin cupo restante o no implementados se saltan sin consumir el presupuesto de la búsqueda (máximo 5 llamadas reales por búsqueda).

### Servicios disponibles

La mayoría exige una **API key** (`auth_kind: api_key`), algunos un **usuario/contraseña** (`user_password`) y unos pocos nada (`mock`, `ddgs`, `feeds`). El registro también lista los dos rastreadores de marca (Playwright y HTML plano) como **no implementados** — todavía no se pueden activar. El servicio `mock` está habilitado por defecto para que el desarrollo y las pruebas funcionen sin claves externas.

| Slug | Servicio | Autenticación |
|---|---|---|
| `mock` | Mock (desarrollo) | ninguna |
| `feeds` | Tabla de feeds de proveedor | ninguna |
| `ddgs` | DuckDuckGo Images | ninguna |
| `apify` | Apify (scraper de Google Images) | api_key + `actor_id` |
| `barcodelookup` | BarcodeLookup (por EAN) | api_key |
| `brave_images` | Brave Images API | api_key |
| `brightdata` | Bright Data (SERP de Google Images) | api_key + `zone` |
| `dataforseo` | DataForSEO (Google Images) | user_password + `location_name` / `language_name` |
| `decodo_standard` / `decodo_premium` | Proxies de Decodo | user_password |
| `exa` | Exa (búsqueda semántica) | api_key |
| `firecrawl` | Firecrawl | api_key |
| `nexscope` | Nexscope (búsqueda Amazon) | api_key + `marketplace` |
| `openserp` | OpenSERP | api_key |
| `oxylabs` | Oxylabs (Google Images) | user_password |
| `scraperapi` | ScraperAPI (Google Images) | api_key |
| `searchapi` | SearchAPI (Google Images) | api_key |
| `serpapi` | SerpAPI (Google Images) | api_key |
| `serper` | Serper (Google Images) | api_key |
| `skumonster` | SkuMonster (UPC/EAN/SKU) | api_key + `base_url` |
| `tavily` | Tavily | api_key |
| `zenserp` | Zenserp | api_key |
| `scraper_js` / `scraper` | Rastreadores de marca (Playwright / web) | ninguna — **no implementados** |

Las credenciales (API keys, usuarios, contraseñas) se almacenan en la tabla `image_providers` de la base de datos SQLite y se **leen en el momento de cada búsqueda** cuando el motor las necesita — nada se lee del antiguo `config.json` del POC. El panel solo indica si cada credencial está configurada (`has_api_key`, `has_username`, `has_password`) y nunca devuelve los valores almacenados. Los servicios de imágenes son globales a la plataforma (no por negocio) y los gestiona el super administrador.

### Tabla de feeds de proveedor

El servicio `feeds` consulta la tabla `provider_feed_images` (marca + referencia/EAN + URL de imagen). El super administrador puede añadir, buscar y eliminar filas desde el panel o mediante la API `GET/POST/DELETE /api/superadmin/image-providers/feeds`. Antes de los servicios round-robin, el motor consulta esta tabla; el primer hallazgo con una imagen válida gana.

## Configuración del marketplace

### Marketplaces compatibles

| Marketplace | Estado |
|---|---|
| **PrestaShop** | Compatible |
| **WooCommerce** | Planificado |
| **Shopify** | Planificado |

## Seguridad

### Almacenamiento de claves API

Las claves API de PrestaShop y de los proveedores de IA se almacenan en la base de datos SQLite (`ai_provider_config` / `marketplace_config`) y nunca se exponen en las respuestas de la API (enmascaradas como `XXXX...XXXX`). Las credenciales de los servicios de imágenes se almacenan en la tabla `image_providers` y tampoco se exponen nunca — solo se devuelven banderas `has_*`.

> **Nota:** El cifrado AES-256-GCM basado en archivos (`CONFIG_SECRET` / `config.json.key`) ha sido eliminado. La configuración ahora se persiste en la base de datos SQLite.

### Tokens JWT

- **Token de acceso**: Corta duración (15 minutos)
- **Token de actualización**: Larga duración (7 días)
- **Almacenamiento**: Cookies httpOnly (no accesibles vía JavaScript)
- **Firma**: HS256 con `JWT_SECRET` (acceso) y `JWT_REFRESH_SECRET` (actualización)

### Requisitos de contraseña

- Mínimo 8 caracteres
- Al menos 1 letra mayúscula
- Al menos 1 letra minúscula
- Al menos 1 número
- Almacenada con bcrypt (factor de costo 12)

### Bloqueo de cuenta

- **Umbral**: 5 intentos fallidos
- **Duración**: 15 minutos
- **Restablecimiento**: Espera 15 minutos o reinicia el backend

## Base de datos

### Ubicación

Se almacena en el directorio de datos como `catalogai.db`:
- La ruta es `<DATA_DIR>/catalogai.db`.
- Predeterminado: el directorio del punto de entrada compilado (`backend/dist/`). **Establece `DATA_DIR`** en producción a un directorio con permisos de escritura.
- En desarrollo local (`npm run dev` en backend), el predeterminado es el propio directorio del backend.

### Copia de seguridad

```bash
cp <DATA_DIR>/catalogai.db backup/catalogai_$(date +%Y%m%d).db
```

### Restablecimiento

```bash
rm <DATA_DIR>/catalogai.db
cd backend && npm run dev
```

**Advertencia:** Esto elimina todos los datos.

### Esquema

La base de datos usa `CREATE TABLE IF NOT EXISTS` idempotente — nunca se elimina ni se recrea al iniciar. Versión actual del esquema: 6.

**Tablas:**
- `users` — Cuentas de usuario (`active`, `must_change_password`, rol, FK de comercio)
- `comercios` — Negocios
- `marketplaces` — Definiciones de marketplace (global)
- `ai_providers` — Definiciones de proveedores de IA (global)
- `comercio_marketplaces` — Mapeo negocio-marketplace
- `comercio_ai_providers` — Mapeo negocio-proveedor de IA
- `comercio_configs` — Configuraciones del negocio
- `app_settings` — Ajustes de la aplicación
- `image_providers` — Servicios de imágenes (global de la plataforma): slug, nombre, habilitado, `sort_order` de round-robin, config JSON con credenciales, contadores de facturación
- `provider_feed_images` — Filas de imágenes de feed (marca / referencia / EAN / URL) usadas por el servicio `feeds`

## Variables de entorno

### Backend (.env)

Se proporciona una plantilla en `.env.example` (raíz del proyecto).

| Variable | Requerida | Predeterminado | Descripción |
|---|---|---|---|
| `NODE_ENV` | prod | — | `production` desactiva CORS, sirve el frontend compilado y oculta errores detallados |
| `JWT_SECRET` | prod | placeholder dev | Firma los tokens de acceso |
| `JWT_REFRESH_SECRET` | prod | placeholder dev | Firma los tokens de actualización |
| `ADMIN_USER` | — | — | Usuario opcional del super administrador (texto plano). Junto con `ADMIN_PASSWORD` crea la cuenta de super administrador; las sesiones dejan de funcionar si se retiran las variables |
| `ADMIN_PASSWORD` | — | — | Contraseña opcional del super administrador como **hash bcrypt** (12 rondas), generado con `node -e "const b=require('bcryptjs'); b.hash('tu-password',12).then(h=>console.log(h))"` en `backend/`. Si falta cualquiera de las dos variables, nadie puede iniciar sesión como super administrador |
| `DATA_DIR` | prod | directorio del punto de entrada | Directorio con escritura donde se almacena `catalogai.db` |
| `PORT` | — | `3000` | Puerto HTTP |
| `LOG_LEVEL` | — | `info` | Nivel de registro (`debug`, `info`, `warn`, `error`) |
| `LOG_FILE` | — | — | Ruta opcional a la que añadir las líneas de registro (además de consola). El directorio padre debe existir; si el archivo no se puede escribir, el fallo es silencioso |
| `LOG_MAX_SIZE` | — | `10mb` | Rota el archivo de registro al alcanzar este tamaño (bytes, o sufijo `kb`/`mb`/`gb`; `0` desactiva la rotación) |
| `LOG_MAX_FILES` | — | `5` | Número de archivos rotados conservados (`<archivo>.1` … `<archivo>.N`); `0` trunca en lugar de archivar |
| `FRONTEND_URL` | — | `http://localhost:5173` | Opcional. Origen CORS en desarrollo; origen de respaldo para las imágenes del autocompletado mock. No se usa en producción (CORS desactivado, mismo origen) |
| `RATE_LIMIT_WINDOW_MS` | — | `900000` | Ventana de límite de peticiones (ms) |
| `RATE_LIMIT_MAX` | — | `100` | Máximo de peticiones por ventana |
| `MAX_BODY_SIZE` | — | `10mb` | Tamaño máximo del cuerpo JSON |

**Obsoletas (ya no se usan):** `CONFIG_SECRET`, `CONFIG_FILE` — eliminadas con la migración al almacenamiento SQLite.

> **Nota:** La aplicación no carga archivos `.env` por sí misma. Debes: (a) cargar el `.env` mediante el panel del hosting / gestor de procesos, o (b) configurar estas variables como variables de entorno en tu panel de hosting.

### Frontend

No se requieren variables de entorno. En desarrollo, `vite.config.ts` hace proxy de las solicitudes de la API:
- Proxy de API: `/api` → `http://localhost:3000`
- Servidor de desarrollo: `http://localhost:5173`

En producción, el frontend se compila y lo sirve directamente el backend (sin necesidad de proxy).

## Resolución de problemas

### La configuración no se guarda

1. Asegúrate de haber iniciado sesión como administrador
2. Revisa la consola del navegador en busca de errores
3. Verifica que el backend esté ejecutándose
4. Comprueba que `<DATA_DIR>/catalogai.db` exista y sea escribible

### La clave API no funciona

1. Verifica que la clave sea correcta (sin espacios adicionales)
2. Prueba la conexión usando el botón de prueba
3. Revisa la página de estado del proveedor
4. Asegúrate de que la facturación esté activa (para proveedores de pago)

### El prompt no se carga

1. Verifica que "Usar prompt por defecto" esté marcado
2. Haz clic en "Restablecer prompt" para forzar la recarga
3. Revisa los registros del backend en busca de errores
4. Verifica que `default-prompts.ts` exista en el backend

### Base de datos bloqueada

Si ves errores de "database is locked":
1. Detén todas las instancias del backend
2. Elimina `catalogai.db-journal` si existe
3. Reinicia el backend
