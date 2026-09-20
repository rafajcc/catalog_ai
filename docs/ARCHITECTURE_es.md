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
├── ai-text-suggester/      # Generación de texto con IA
│   ├── autocomplete.ts     # Construcción del prompt, contrato JSON, propuestas
│   ├── default-prompts.ts  # Prompts predeterminados ES/EN con búsqueda web obligatoria
│   └── image-url-validation.ts  # Validación HTTP de URLs de imagen antes de usarlas
├── ai-providers/           # Proveedores de IA como clases por servicio + registro
│   └── providers/          # OpenAI, Anthropic, OpenRouter, Mock
├── image-providers/        # Servicios de imágenes + motor (feeds primero, round-robin)
│   ├── router.ts           # Endpoints de super admin (/api/superadmin/image-providers)
│   ├── registry.ts         # Definiciones de servicios + siembra idempotente en BD
│   ├── services/engine.ts  # Consulta de feeds primero, round-robin, ciclos de facturación
│   ├── utils/http-client.ts# Cliente HTTP compartido de los servicios (axios)
│   └── providers/          # Apify, SerpAPI, Serper, Brave, DataForSEO, Mock, feeds, ...
├── prestashop-client/      # Cliente de la API Webservice de PrestaShop
├── prestashop-fetcher/     # Obtención de productos por referencia/marca con filtros
├── database-persistence/   # Persistencia SQLite por comercio (sql.js)
└── auth/                   # Autenticación y gestión de usuarios multiinquilino
    ├── auth.ts             # JWT, bcrypt, validación de contraseñas
    ├── routes.ts           # Endpoints de login, registro, gestión de usuarios
    ├── middleware.ts        # Middleware requireAuth, requireRole
    ├── database.ts         # Esquema, consultas de usuario/comercio, almacén de image_providers
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
- **Credenciales**: Almacenadas en la base de datos SQLite, nunca expuestas en el frontend (enmascaradas)
- **JWT**: Cookies httpOnly con tokens de acceso y actualización
- **Hash de contraseñas**: bcrypt con factor de costo 12
- **Bloqueo de cuenta**: 5 intentos fallidos / 15 minutos

### Integración con IA
- **Proveedores**: OpenAI, Anthropic, OpenRouter, Mock (para pruebas), implementados como clases por servicio registradas en `ai-providers/registry.ts`.
- **Búsqueda web**: Búsqueda web obligatoria para el enriquecimiento de datos de productos (se mantiene en el prompt).
- **Alcance**: La IA solo propone los campos de texto vacíos (`description_short`, `description`, `meta_title`, `meta_description`) como JSON estructurado. Las URLs de imagen no se piden a la IA — las aporta el motor de servicios de imágenes.
- **Prompts predeterminados**: Incluyen "BÚSQUEDA WEB OBLIGATORIA" más el contrato fijo de respuesta JSON.

### Servicios de imágenes
- **Dos capas separadas**: los servicios (`image-providers/providers/*`) hablan HTTP con sus proveedores a través de `utils/http-client.ts`; el motor (`services/engine.ts`) los coordina.
- **Feeds primero**: cuando está habilitado, el servicio `feeds` cruza marca/referencia/EAN con la tabla `provider_feed_images` de la BD antes de cualquier llamada externa (gratuito, sin facturación). **No forma parte del round-robin** y nunca avanza el cursor del round-robin.
- **Round-robin**: los servicios habilitados (todos excepto `feeds`) se prueban en `sort_order`, empezando siempre después del último llamado, hasta 5 llamadas reales por búsqueda de producto.
- **Ciclos de facturación**: cada servicio tiene un `max_calls_per_month` opcional + `billing_cycle_day`; los contadores se renuevan solos y se exponen al super administrador. Los servicios sin cupo o sin configurar se saltan sin consumir el presupuesto de la búsqueda.
- **Validación**: cada URL candidata se valida por HTTP (`image-url-validation.ts`) antes de llegar al frontend; los resultados se limitan a 5.

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
- **AppHeader**: Chip de estado, insignia de versión (desde `GET /api/status`), selector de idioma, botones de configuración/usuarios, info del usuario
- **ConfigurationForm**: Configuración de PrestaShop + proveedor de IA, seguimiento de cambios pendientes
- **UploadSection**: Panel de importación de PrestaShop con filtros
- **ProductsViewPage**: Cuadrícula de productos con edición en línea, autocompletado IA (campos de texto) + sugerencias de imágenes, lightbox de imágenes
- **UserManagementPage**: CRUD de usuarios solo para administradores
- **SuperAdminPage**: Super administrador de la plataforma — gestión de negocios, panel de servicios de imágenes, tabla de feeds de proveedor

### Estado del backend
- Consulta `GET /api/status` cada 30 segundos (versión + estado)
- El estado se muestra como chip en el encabezado (Online/Offline/Degraded); la insignia de versión lee la misma respuesta

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
2. El backend carga el prompt almacenado (personalizado o el predeterminado del idioma de la UI) y envía cada producto + el contrato fijo de respuesta JSON a la IA
3. La IA devuelve JSON solo con los campos de texto propuestos (descripción corta/larga, meta título, meta descripción)
4. El backend valida la respuesta, fusiona las propuestas no vacías y resuelve las imágenes del producto con el motor de servicios de imágenes en la misma petición
5. El frontend actualiza la cuadrícula de productos con las propuestas y miniaturas
6. El usuario puede aceptar/rechazar cambios individuales
7. Los campos modificados se envían de vuelta a PrestaShop vía Webservice

### Flujo de búsqueda de imágenes
1. El motor lee los servicios habilitados de la BD (`image_providers`) con sus credenciales, orden y contadores de facturación
2. Si el servicio `feeds` está habilitado, primero consulta su tabla (`provider_feed_images`) por marca/referencia/EAN
3. Si no hay acierto, prueba los servicios en round-robin (empezando después del último llamado) hasta 5 llamadas reales por producto
4. El primer servicio que devuelva >= 1 imagen validada gana; las fuentes se registran por intento
5. Las URLs devueltas (máx. 5) se validan por HTTP, se muestran a través del proxy del backend y se guardan en PrestaShop a demanda
