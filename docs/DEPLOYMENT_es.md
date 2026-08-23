# Despliegue

Guía de despliegue en producción de Catálogo IA.

## Build para producción

### Backend

```bash
cd backend
npm run build      # Compila TypeScript a dist/
npm start          # Inicia el servidor de producción
```

### Frontend

```bash
cd frontend
npm run build      # Genera archivos estáticos optimizados en dist/
```

La carpeta `dist/` contiene:
- `index.html` — Punto de entrada
- `assets/` — JS/CSS empaquetados con hashes de contenido
- Archivos estáticos (imágenes, etc.)

## Opciones de despliegue

### Opción 1: Servidor único (Recomendado)

Sirve tanto el backend como el frontend desde el mismo servidor.

**Configuración de Nginx:**

```nginx
server {
    listen 80;
    server_name catalog.example.com;

    # Archivos estáticos del frontend
    root /var/www/catalog_ai/frontend/dist;
    index index.html;

    # Proxy de API
    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # Fallback SPA
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

### Opción 2: Servicios separados

**Backend (Node.js):**
```bash
# Usando PM2 para gestión de procesos
npm install -g pm2
cd backend
pm2 start dist/index.js --name catalog-api
pm2 save
pm2 startup  # Sigue las instrucciones para inicio automático al arrancar
```

**Frontend (Estático):**
Despliega `frontend/dist/` en:
- Alojamiento estático Nginx/Apache
- Netlify
- Vercel
- AWS S3 + CloudFront
- Cualquier servicio de alojamiento de archivos estáticos

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
