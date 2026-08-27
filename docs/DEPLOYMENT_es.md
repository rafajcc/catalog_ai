# Despliegue

Guía de despliegue en producción de Catálogo IA.

## Build para producción

Catálogo IA es un solo proceso. Desde la raíz del proyecto:

```bash
npm run build      # Construye el frontend, copia a backend/public, compila el backend
npm start          # Inicia el servidor de producción (sirve API + frontend)
```

El backend sirve:
- La API en `/api/*`
- Los archivos estáticos del frontend (aplicación React) desde `backend/public/`
- Un fallback SPA que devuelve `index.html` para las rutas que no son API

El comando `npm run build` ejecuta:
1. `npm run build --prefix frontend` — construye la app React en `frontend/dist/`
2. `node copy-dist.js` — copia el contenido de `frontend/dist/` a `backend/public/`
3. `npm run build --prefix backend` — compila el backend TypeScript a `backend/dist/`

## Opciones de despliegue

### Opción 1: Proceso único de Node.js (Recomendado)

Despliega `backend/dist/index.js` como comando de inicio. Sirve tanto la API como el frontend en un solo puerto.

**Cualquier hosting Node.js** (Railway, Render, Heroku, un VPS, etc.):

1. Establece el comando de inicio como: `npm start` (o `node backend/dist/index.js`)
2. Establece `NODE_ENV=production`
3. Establece las variables de entorno requeridas (ver más abajo)

**Con PM2 en un VPS:**

```bash
npm install -g pm2
cd catalog_ai
npm run build
NODE_ENV=production pm2 start backend/dist/index.js --name catalog-ai
pm2 save
pm2 startup  # Sigue las instrucciones para inicio automático al arrancar
```

Si quieres un proxy inverso (Nginx) delante para SSL, solo reenvía todo el tráfico al proceso Node:

```nginx
server {
    listen 80;
    server_name catalog.example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

No se necesita una ubicación `/api/` ni un fallback SPA `try_files` — el proceso Node lo maneja todo.

### Opción 2: Backend separado + Frontend estático (Opcional)

Si prefieres una CDN para el frontend:

**Backend (Node.js):**
```bash
npm install -g pm2
cd catalog_ai
npm run build:backend
pm2 start backend/dist/index.js --name catalog-api
pm2 save
```

**Frontend (Estático):**
Despliega el contenido de `frontend/dist/` en:
- Alojamiento estático Nginx/Apache
- Netlify
- Vercel
- AWS S3 + CloudFront

⚠️ **Nota:** En esta configuración, establece `NODE_ENV` como `development` (para que CORS esté habilitado) y `FRONTEND_URL` con tu URL del frontend, ya que el frontend y el backend están en orígenes diferentes.

### Opción 3: Docker (Futuro)

El soporte Docker está planeado. Consulta la documentación de Docker cuando esté disponible.

## Variables de entorno

Establece estas en tu entorno de producción:

```bash
# Requeridas
NODE_ENV=production
PORT=3000
FRONTEND_URL=https://catalog.example.com

# Opcionales (se generan automáticamente si no se establecen)
JWT_SECRET=tu-cadena-aleatoria-segura
CONFIG_SECRET=tu-cadena-aleatoria-segura

# Opcional
DATA_DIR=/var/lib/catalog_ai
```

### Generación de claves seguras

```bash
# Generar secreto JWT
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

# Generar clave de encriptación
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## SSL/TLS

Siempre usa HTTPS en producción. Opciones:

1. **Let's Encrypt** (gratis): Usa Certbot con Nginx
2. **Cloudflare**: SSL gratis con proxy de Cloudflare
3. **AWS ACM**: Para despliegues en AWS

### Configuración de Let's Encrypt

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d catalog.example.com
sudo certbot renew --dry-run  # Probar renovación automática
```

## Copia de seguridad de la base de datos

La base de datos SQLite es un solo archivo (`catalogai.db`). Haz copias de seguridad regularmente:

```bash
# Copia de seguridad
cp /ruta/a/catalogai.db /backup/catalogai_$(date +%Y%m%d).db

# O usa el comando de backup de SQLite
sqlite3 /ruta/a/catalogai.db ".backup '/backup/catalogai.db'"
```

### Copia de seguridad automatizada (Crontab)

```bash
# Copia de seguridad diaria a las 2 AM
0 2 * * * cp /var/lib/catalog_ai/catalogai.db /backup/catalogai_$(date +\%Y\%m\%d).db
```

## Monitoreo

### Verificación de salud

```bash
curl http://localhost:3000/api/health
# Debería devolver: {"status":"ok"}
```

### Monitoreo con PM2

```bash
pm2 status
pm2 logs catalog-api
pm2 monit
```

## Escalabilidad

### Escalabilidad horizontal

Para alta disponibilidad:
1. Usa un balanceador de carga (Nginx, HAProxy, AWS ALB)
2. Comparte la base de datos SQLite vía NFS o usa una base de datos distribuida
3. Considera PostgreSQL para escenarios de alta concurrencia

### Escalabilidad vertical

SQLite maneja la mayoría de las cargas de trabajo bien. Para tráfico muy alto:
- Aumenta la RAM del servidor
- Usa almacenamiento SSD
- Considera la migración a PostgreSQL

## Lista de verificación de seguridad

- [ ] HTTPS habilitado
- [ ] JWT_SECRET establecido con una clave fuerte
- [ ] CONFIG_SECRET establecido con una clave fuerte
- [ ] El archivo de base de datos no es accesible públicamente
- [ ] El archivo `.env` no está en el control de versiones
- [ ] Copias de seguridad regulares de la base de datos
- [ ] Firewall configurado (solo puertos 80/443 abiertos)
- [ ] Actualizaciones de seguridad automáticas habilitadas
