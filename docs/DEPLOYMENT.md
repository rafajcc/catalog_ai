# Deployment

Production deployment guide for Catalog AI.

## Build for Production

Catalog AI is a single process. From the project root:

```bash
npm run build      # Builds frontend, copies to backend/public, compiles backend
npm start          # Starts the production server (serves API + frontend)
```

The backend serves:
- The API at `/api/*`
- The frontend static files (React app) from `backend/public/`
- A SPA fallback that returns `index.html` for non-API routes

The `npm run build` command runs:
1. `npm run build --prefix frontend` — builds the React app to `frontend/dist/`
2. `node copy-dist.js` — copies `frontend/dist/*` into `backend/public/`
3. `npm run build --prefix backend` — compiles the TypeScript backend to `backend/dist/`

## Deployment Options

### Option 1: Single Node.js Process (Recommended)

Deploy `backend/dist/index.js` as the start command. It serves both the API and the frontend on one port.

**Any Node.js hosting** (Railway, Render, Heroku, a VPS, etc.):

1. Set the start command to: `npm start` (or `node backend/dist/index.js`)
2. Set `NODE_ENV=production`
3. Set the required environment variables (see below)

**With PM2 on a VPS:**

```bash
npm install -g pm2
cd catalog_ai
npm run build
NODE_ENV=production pm2 start backend/dist/index.js --name catalog-ai
pm2 save
pm2 startup  # Follow instructions to auto-start on boot
```

If you want a reverse proxy (Nginx) in front for SSL, just forward all traffic to the Node process:

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

No `/api/` location or SPA `try_files` fallback is needed — the Node process handles everything.

### Option 2: Separate Backend + Static Frontend (Optional)

If you prefer a CDN for the frontend:

**Backend (Node.js):**
```bash
npm install -g pm2
cd catalog_ai
npm run build:backend
pm2 start backend/dist/index.js --name catalog-api
pm2 save
```

**Frontend (Static):**
Deploy the contents of `frontend/dist/` to:
- Nginx/Apache static hosting
- Netlify
- Vercel
- AWS S3 + CloudFront

⚠️ **Note:** In this setup, set `NODE_ENV` to `development` (so CORS is enabled) and `FRONTEND_URL` to your frontend URL, since the frontend and backend are on different origins.

### Option 3: Docker (Future)

Docker support is planned. See [Docker documentation](./DOCKER.md) when available.

## Environment Variables

Set these in your production environment:

```bash
# Required
NODE_ENV=production
PORT=3000
FRONTEND_URL=https://catalog.example.com

# Optional (auto-generated if not set)
JWT_SECRET=your-secure-random-string
CONFIG_SECRET=your-secure-random-string

# Optional
DATA_DIR=/var/lib/catalog_ai
```

### Generating Secure Keys

```bash
# Generate JWT secret
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

# Generate encryption key
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## SSL/TLS

Always use HTTPS in production. Options:

1. **Let's Encrypt** (free): Use Certbot with Nginx
2. **Cloudflare**: Free SSL with Cloudflare proxy
3. **AWS ACM**: For AWS deployments

### Let's Encrypt Setup

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d catalog.example.com
sudo certbot renew --dry-run  # Test auto-renewal
```

## Database Backup

The SQLite database is a single file (`catalogai.db`). Back it up regularly:

```bash
# Backup
cp /path/to/catalogai.db /backup/catalogai_$(date +%Y%m%d).db

# Or use SQLite's backup command
sqlite3 /path/to/catalogai.db ".backup '/backup/catalogai.db'"
```

### Automated Backup (Crontab)

```bash
# Daily backup at 2 AM
0 2 * * * cp /var/lib/catalog_ai/catalogai.db /backup/catalogai_$(date +\%Y\%m\%d).db
```

## Monitoring

### Health Check

```bash
curl http://localhost:3000/api/health
# Should return: {"status":"ok"}
```

### PM2 Monitoring

```bash
pm2 status
pm2 logs catalog-api
pm2 monit
```

## Scaling

### Horizontal Scaling

For high availability:
1. Use a load balancer (Nginx, HAProxy, AWS ALB)
2. Share the SQLite database via NFS or use a distributed database
3. Consider PostgreSQL for high-concurrency scenarios

### Vertical Scaling

SQLite handles most workloads well. For very high traffic:
- Increase server RAM
- Use SSD storage
- Consider PostgreSQL migration

## Security Checklist

- [ ] HTTPS enabled
- [ ] Strong JWT_SECRET set
- [ ] Strong CONFIG_SECRET set
- [ ] Database file not publicly accessible
- [ ] `.env` file not in version control
- [ ] Regular database backups
- [ ] Firewall configured (only ports 80/443 open)
- [ ] Automatic security updates enabled
