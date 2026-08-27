# Arquitectura

Arquitectura técnica y decisiones de diseño interno de Catálogo IA.

## Visión general

Catálogo IA es una aplicación full-stack con un backend Express.js y un frontend React, usando SQLite para la persistencia por inquilino. En producción, el backend sirve tanto la API como el frontend compilado desde un solo proceso en un solo puerto.

```
┌─────────────────────────────────────────────────────────────┐
│  Servidor Express (proceso único, puerto único)             │
│  http://localhost:3000                                      │
│                                                             │
│  ┌──────────────────────────────────────────┐               │
│  │  Frontend (React + TypeScript, estático) │               │
│  │  servido desde backend/public/           │               │
│  └──────────────────────────────────────────┘               │
│  ┌──────────────────────────────────────────┐               │
│  │  API (/api/*)                            │               │
│  └──────────────────────────────────────────┘               │
│  ┌──────────────────────────────────────────┐               │
│  │  Base de datos (SQLite vía sql.js)       │               │
│  │  catalogai.db                            │               │
│  └──────────────────────────────────────────┘               │
└─────────────────────────────────────────────────────────────┘
```

En desarrollo, el frontend se ejecuta en su propio servidor de desarrollo Vite (http://localhost:5173) que hace proxy de las solicitudes `/api` al backend (http://localhost:3000). En producción, `npm run build` copia la app React compilada a `backend/public/`, que Express sirve como archivos estáticos con un fallback SPA.

## Arquitectura del backend

### Arquitectura del servidor
- Express.js proporciona un framework web ligero y escalable
- Arquitectura basada en módulos con separación clara de responsabilidades
- Cada módulo maneja una única responsabilidad

### Sistema de módulos

```
backend/src/modules/
├── ai-text-suggester/      # Generación de texto con IA y extracción de URLs de imágenes
│   ├── autocomplete.ts     # Lógica de autocompletado con IA y búsqueda web/imagen
│   ├── default-prompts.ts  # Prompts predeterminados ES/EN con búsqueda obligatoria
│   └── providers/          # Implementaciones de proveedores (OpenAI, Anthropic, etc.)
├── prestashop-client/      # Cliente de la API Webservice de PrestaShop
├── prestashop-fetcher/     # Obtención de productos por referencia/marca con filtros
├── config-persistence/     # Persistencia heredada de configuración encriptada
├── database-persistence/   # Persistencia SQLite por comercio (sql.js)
└── auth/                   # Autenticación y gestión de usuarios multiinquilino
    ├── auth.ts             # JWT, bcrypt, validación de contraseñas
    ├── routes.ts           # Endpoints de login, registro, gestión de usuarios
    ├── middleware.ts        # Middleware requireAuth, requireRole
    ├── database.ts         # Esquema, consultas de usuario/comercio
    └── load-config-middleware.ts  # DataStore por request desde la DB
```

### Base de datos
- **Motor**: SQLite vía sql.js (WASM puro, sin dependencias nativas)
- **Esquema**: `CREATE TABLE IF NOT EXISTS` idempotente — la base de datos nunca se elimina ni se recrea al iniciar
- **Multiinquilino**: Todas las tablas de configuración están delimitadas por `comercio_id` FK
- **Tablas globales**: `marketplaces` y `ai_providers` (compartidas entre inquilinos)
- **Tablas de unión**: `comercio_marketplaces` y `comercio_ai_providers`
- **Persistencia**: Escribe en `catalogai.db` en cada cambio

### Seguridad
- **Credenciales**: Encriptadas en reposo (AES-256-GCM), nunca expuestas en el frontend
- **JWT**: Cookies httpOnly con tokens de acceso y actualización
- **Hash de contraseñas**: bcrypt con factor de costo 12
- **Bloqueo de cuenta**: 5 intentos fallidos / 15 minutos
- **Clave de encriptación**: Desde la variable de entorno `CONFIG_SECRET` o generada automáticamente en `config.json.key`

### Integración con IA
- **Proveedores**: OpenAI, Anthropic, OpenRouter, GPT4All, Mock (para pruebas)
- **Búsqueda web**: Búsqueda web obligatoria para el enriquecimiento de datos de productos
- **Búsqueda de imágenes**: Inyección dinámica de cantidad de imágenes basada en las imágenes actuales del producto
- **Formato de respuesta**: JSON con campos estructurados (name, description, meta, image_urls)
- **Prompts predeterminados**: Incluyen "BÚSQUEDA WEB OBLIGATORIA" y "BÚSQUEDA DE IMÁGENES"

### Manejo de imágenes
- **Solo proxy**: Sin almacenamiento en disco, las imágenes se obtienen en vivo de URLs externas
- **Proxy del backend**: `GET /api/images/proxy?url=...` con timeout de 15s, validación de content-type
- **Proxy del frontend**: `proxyImageUrl()` en ApiService aplica proxy a todas las imágenes
- **Guardado en PrestaShop**: El backend descarga desde la URL externa del lado del servidor y sube vía Webservice

## Arquitectura del frontend

### Estructura de componentes
- **Basado en componentes**: Componentes React modulares para cada pantalla/propósito
- **Gestión de estado**: React useState + useEffect, sin Redux/Zustand
- **Enrutamiento**: Enrutamiento basado en estado (login → registro → dashboard), sin React Router

### Componentes clave
- **AppHeader**: Chip de estado, selector de idioma, botones de configuración/usuarios, info del usuario
- **ConfigurationForm**: Configuración de PrestaShop + proveedor de IA, seguimiento de cambios pendientes
- **UploadSection**: Panel de importación de PrestaShop con filtros
- **ProductsViewPage**: Cuadrícula de productos con edición en línea, autocompletado IA, lightbox de imágenes
- **UserManagementPage**: CRUD de usuarios solo para administradores

### Estado del backend
- Consulta el endpoint `/api/health` cada 30 segundos
- El estado se muestra como chip en el encabezado (Online/Offline/Degraded)
- Se recupera automáticamente cuando el backend vuelve a estar disponible

### Internacionalización
- **Idioma predeterminado**: Español (es)
- **Disponible**: Inglés (en)
- **Almacenamiento**: La preferencia se persiste en `localStorage`
- **Implementación**: I18nProvider personalizado con contexto, sin librería externa de i18n

## Flujo de datos

### Importación de productos
1. El usuario configura la conexión con PrestaShop (URL, API key)
2. El usuario establece opcionalmente filtros (referencias, marca, descripción, imágenes)
3. El backend obtiene productos vía la API Webservice de PrestaShop
4. Los productos se almacenan en memoria (no en la base de datos)
5. El frontend los muestra en cuadrícula con campos SEO y miniaturas de imágenes

### Autocompletado con IA
1. El usuario selecciona productos para enriquecer
2. El backend envía los datos del producto + instrucciones de búsqueda obligatoria a la IA
3. La IA devuelve JSON con campos enriquecidos (nombre, descripción, meta, imágenes)
4. El backend extrae y valida la respuesta
5. El frontend actualiza la cuadrícula de productos con las propuestas
6. El usuario puede aceptar/rechazar cambios individuales
7. Los campos modificados se envían de vuelta a PrestaShop vía Webservice

### Flujo de búsqueda de imágenes
1. El backend calcula `imagesNeeded = 5 - (product.images?.length ?? 0)`
2. Si es > 0, agrega una instrucción dinámica al prompt de IA con el conteo exacto
3. La IA busca y devuelve URLs de imágenes
4. El frontend aplica un límite de `imagesNeeded` como red de seguridad
5. Las imágenes se muestran en la cuadrícula de productos vía el proxy del backend
