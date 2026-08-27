# Installation

Detailed installation and setup guide for Catalog AI.

## Prerequisites

- **Node.js 18+** (for both backend and frontend)
- **npm** (comes with Node.js)
- **Git** for version control
- **TypeScript** (installed as dev dependency)

## Quick Start

```bash
# Clone the repository
git clone https://github.com/rafajcc/catalog_ai.git
cd catalog_ai

# Install all dependencies
npm install --prefix backend && npm install --prefix frontend
```

## Environment Configuration

### Backend Environment

Copy the example environment file (project root) and configure it:

```bash
cp .env.example .env
```

Edit `.env` with your settings:

```bash
# Application mode: production disables CORS and serves the built frontend
NODE_ENV=development

# Server port (default: 3000)
PORT=3000

# CORS origin (development only)
FRONTEND_URL=http://localhost:5173

# JWT signing secrets (REQUIRED in production - set long random values)
JWT_SECRET=your-secret-key
JWT_REFRESH_SECRET=your-refresh-secret-key

# Data directory (where catalogai.db is stored - must be writable)
DATA_DIR=.
```

### Environment Variables Reference

| Variable | Default | Description |
|---|---|---|
| `NODE_ENV` | `development` | `development` or `production` (production disables CORS, serves built frontend) |
| `PORT` | `3000` | Backend server port |
| `FRONTEND_URL` | `http://localhost:5173` | Frontend URL for CORS (development only) |
| `JWT_SECRET` | dev placeholder | Secret for JWT access token signing |
| `JWT_REFRESH_SECRET` | dev placeholder | Secret for JWT refresh token signing |
| `DATA_DIR` | entry-point dir | Directory for the SQLite database |
| `LOG_LEVEL` | `info` | Logging level |

### First Run

On first startup:
1. SQLite database (`catalogai.db`) is auto-created in `DATA_DIR`
2. The schema is applied idempotently (`CREATE TABLE IF NOT EXISTS`) — it is never deleted or recreated

## Running the Application

### Development Mode

```bash
# Build frontend and start the backend (serves frontend static files)
npm run build
npm start
```

The backend starts at http://localhost:3000 and serves the frontend from the same port.

For development with hot-reload, you can run them separately:

```bash
# Terminal 1 - Backend (hot-reload)
cd backend
npm run dev

# Terminal 2 - Frontend (Vite dev server)
cd frontend
npm run dev
```

Frontend dev server starts at http://localhost:5173 (proxies API to backend).

### First-Time Setup

1. Open http://localhost:3000 in your browser
2. Click "Registrar nuevo comercio" (Register new business)
3. Enter:
   - Business name (e.g., "My Store")
   - Admin username
   - Admin password (min 8 chars, uppercase, lowercase, number)
4. You're automatically logged in
5. Click the settings icon to configure PrestaShop and AI provider

### Production Build

```bash
# From the project root
npm run build      # Builds frontend, copies to backend/public, compiles backend
npm start          # Starts the production server (serves API + frontend)
```

The backend serves both the API (`/api/*`) and the frontend static files from a single process on one port.

## Troubleshooting

### Port Conflicts

If port 3000 or 5173 is in use:

```bash
# Backend - use different port
PORT=3001 npm run dev

# Frontend - Vite will automatically try the next available port
```

### CORS Errors

Ensure `FRONTEND_URL` in your `.env` matches your frontend URL:
```bash
FRONTEND_URL=http://localhost:5173  # or your production URL
```

### Database Issues

The SQLite file (`catalogai.db`) is auto-created on startup.

**Reset database:**
```bash
rm <DATA_DIR>/catalogai.db
cd backend && npm run dev
```

**Note:** This deletes all data (users, configurations, etc.).

### Login Issues

1. **No users exist**: Register a new business via the login page
2. **Account locked**: Wait 15 minutes or restart the backend
3. **Password forgotten**: Admin can reset via User Management

### TypeScript Errors

```bash
# Backend
cd backend
npm run typecheck

# Frontend
cd frontend
npm run typecheck
```

### Lint Errors

```bash
# Backend
cd backend
npm run lint:fix

# Frontend
cd frontend
npm run lint:fix
```
