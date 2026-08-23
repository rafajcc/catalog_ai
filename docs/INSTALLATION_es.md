# Instalación

Guía de instalación y configuración detallada de Catálogo IA.

## Requisitos previos

- **Node.js 18+** (tanto para el backend como el frontend)
- **npm** (viene con Node.js)
- **Git** para control de versiones
- **TypeScript** (instalado como dependencia de desarrollo)

## Inicio rápido

```bash
# Clona el repositorio
git clone https://github.com/rafajcc/catalog_ai.git
cd catalog_ai

# Instala las dependencias del backend
cd backend
npm install

# Instala las dependencias del frontend
cd ../frontend
npm install
```

## Configuración del entorno

### Entorno del backend

Copia el archivo de entorno de ejemplo y configúralo:

```bash
cd backend
cp .env.example .env
```

Edita `backend/.env` con tu configuración:

```bash
# Puerto del servidor (predeterminado: 3000)
PORT=3000

# Origen CORS (URL del frontend)
FRONTEND_URL=http://localhost:5173

# Secreto JWT (se genera automáticamente si no se establece)
JWT_SECRET=tu-clave-secreta

# Clave de encriptación para las API keys (se genera automáticamente si no se establece)
CONFIG_SECRET=tu-clave-de-encriptación

# Directorio de datos (donde se almacena catalogai.db)
DATA_DIR=.
```

### Referencia de variables de entorno

| Variable | Predeterminado | Descripción |
|---|---|---|
| `PORT` | `3000` | Puerto del servidor backend |
| `FRONTEND_URL` | `http://localhost:5173` | URL del frontend para CORS |
| `JWT_SECRET` | 自动生成 | Secreto para la firma JWT |
| `CONFIG_SECRET` | 自动生成 | Clave de encriptación para las API keys |
| `DATA_DIR` | `.` | Directorio para la base de datos SQLite |
| `NODE_ENV` | `development` | `development` o `production` |

### Primera ejecución

En el primer inicio:
1. La base de datos SQLite (`catalogai.db`) se crea automáticamente
2. Si `JWT_SECRET` no está establecido, se genera un archivo de clave aleatorio (`jwt.key`)
3. Si `CONFIG_SECRET` no está establecido, se genera un archivo de clave aleatorio (`config.json.key`)

## Ejecución de la aplicación

### Modo desarrollo

Abre **dos terminales** y ejecuta un comando en cada una:

**Terminal 1 - Backend:**
```bash
cd backend
npm run dev
```

El backend se inicia en http://localhost:3000

**Terminal 2 - Frontend:**
```bash
cd frontend
npm run dev
```

El frontend se inicia en http://localhost:5173

### Configuración inicial

1. Abre http://localhost:5173 en tu navegador
2. Haz clic en "Registrar nuevo comercio"
3. Ingresa:
   - Nombre del negocio (ej: "Mi Tienda")
   - Nombre de usuario de administrador
   - Contraseña de administrador (mín. 8 caracteres, mayúscula, minúscula, número)
4. Se te iniciará sesión automáticamente
5. Haz clic en el ícono de configuración para configurar PrestaShop y el proveedor de IA

### Build de producción

**Backend:**
```bash
cd backend
npm run build      # Compila TypeScript a dist/
npm start          # Ejecuta el servidor compilado
```

**Frontend:**
```bash
cd frontend
npm run build      # Genera archivos estáticos optimizados en dist/
```

La carpeta `dist/` del frontend contiene archivos estáticos que puedes desplegar en cualquier servidor web.

## Resolución de problemas

### Conflictos de puerto

Si el puerto 3000 o 5173 está en uso:

```bash
# Backend - usar un puerto diferente
PORT=3001 npm run dev

# Frontend - Vite intentará automáticamente el siguiente puerto disponible
```

### Errores de CORS

Asegúrate de que `FRONTEND_URL` en `backend/.env` coincida con la URL de tu frontend:
```bash
FRONTEND_URL=http://localhost:5173  # o tu URL de producción
```

### Problemas de base de datos

El archivo SQLite (`catalogai.db`) se crea automáticamente al iniciar.

**Restablecer base de datos:**
```bash
rm backend/catalogai.db
rm backend/config.json.key  # opcional, para una nueva clave de encriptación
cd backend && npm run dev
```

**Nota:** Esto elimina todos los datos (usuarios, configuraciones, etc.).

### Problemas de inicio de sesión

1. **No existen usuarios**: Registra un nuevo comercio desde la página de inicio de sesión
2. **Cuenta bloqueada**: Espera 15 minutos o reinicia el backend
3. **Contraseña olvidada**: El administrador puede restablecerla desde la Gestión de usuarios

### Errores de TypeScript

```bash
# Backend
cd backend
npm run typecheck

# Frontend
cd frontend
npm run typecheck
```

### Errores de lint

```bash
# Backend
cd backend
npm run lint:fix

# Frontend
cd frontend
npm run lint:fix
```
