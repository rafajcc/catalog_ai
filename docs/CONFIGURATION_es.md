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
| **GPT4All** | Modelos locales | No |
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

2. **BÚSQUEDA DE IMÁGENES**
   - Buscar imágenes del producto
   - Conteo dinámico basado en las imágenes actuales
   - Devolver el número exacto de URLs solicitadas

3. **Formato de respuesta**
   - JSON estructurado con campos específicos
   - URLs de imágenes en un array dedicado
   - Campos meta optimizados para SEO

## Configuración del marketplace

### Marketplaces compatibles

| Marketplace | Estado |
|---|---|
| **PrestaShop** | Compatible |
| **WooCommerce** | Planificado |
| **Shopify** | Planificado |

## Seguridad

### Encriptación de claves API

Todas las claves API se encriptan en reposo usando AES-256-GCM:
- Clave de encriptación: Variable de entorno `CONFIG_SECRET`
- Se genera automáticamente si no se establece (almacenada en `config.json.key`)
- Nunca se exponen en las respuestas de la API (enmascaradas como `XXXX...XXXX`)

### Tokens JWT

- **Token de acceso**: Corta duración (15 minutos)
- **Token de actualización**: Larga duración (7 días)
- **Almacenamiento**: Cookies httpOnly (no accesibles vía JavaScript)
- **Firma**: HS256 con `JWT_SECRET`

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

Predeterminado: `backend/catalogai.db`

### Copia de seguridad

```bash
cp backend/catalogai.db backup/catalogai_$(date +%Y%m%d).db
```

### Restablecimiento

```bash
rm backend/catalogai.db
rm backend/config.json.key  # opcional
cd backend && npm run dev
```

**Advertencia:** Esto elimina todos los datos.

### Esquema

La base de datos usa `CREATE TABLE IF NOT EXISTS` idempotente — nunca se elimina ni se recrea al iniciar. Versión actual del esquema: 3.

**Tablas:**
- `users` — Cuentas de usuario
- `comercios` — Negocios
- `marketplaces` — Definiciones de marketplace (global)
- `ai_providers` — Definiciones de proveedores de IA (global)
- `comercio_marketplaces` — Mapeo negocio-marketplace
- `comercio_ai_providers` — Mapeo negocio-proveedor de IA
- `comercio_configs` — Configuraciones del negocio
- `app_settings` — Configuraciones de la aplicación

## Variables de entorno

### Backend (.env)

```bash
# Servidor
PORT=3000
NODE_ENV=development

# CORS
FRONTEND_URL=http://localhost:5173

# Seguridad (se generan automáticamente si no se establecen)
JWT_SECRET=tu-secreto-jwt
CONFIG_SECRET=tu-secreto-config

# Base de datos
DATA_DIR=.
```

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
4. Comprueba que `backend/catalogai.db` exista y sea escribible

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
