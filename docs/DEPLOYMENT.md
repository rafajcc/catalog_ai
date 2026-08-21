# Deployment

Production deployment guide for Catalog AI.

## Build for Production

### Backend

```bash
cd backend
npm run build      # Compile TypeScript to dist/
npm start          # Start the production server
```

### Frontend

```bash
cd frontend
npm run build      # Generate optimized static files to dist/
```

The `dist/` folder contains:
- `index.html` - Entry point
- `assets/` - Bundled JS/CSS with content hashes
- Static files (images, etc.)

## Deployment Options

### Option 1: Single Server (Recommended)

Serve both backend and frontend from the same server.

**Nginx Configuration:**

```nginx
server {
    listen 80;
    server_name catalog.example.com;

    # Frontend static files
    root /var/www/catalog_ai/frontend/dist;
    index index.html;

    # API proxy
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

    # SPA fallback
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

### Option 2: Separate Services

**Backend (Node.js):**
```bash
# Using PM2 for process management
npm install -g pm2
cd backend
pm2 start dist/index.js --name catalog-api
pm2 save
pm2 startup  # Follow instructions to auto-start on boot
```

**Frontend (Static):**
Deploy `frontend/dist/` to:
- Nginx/Apache static hosting
- Netlify
- Vercel
- AWS S3 + CloudFront
- Any static file hosting service

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
