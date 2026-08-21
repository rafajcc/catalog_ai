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

# Install backend dependencies
cd backend
npm install

# Install frontend dependencies
cd ../frontend
npm install
```

## Environment Configuration

### Backend Environment

Copy the example environment file and configure it:

```bash
cd backend
cp .env.example .env
```

Edit `backend/.env` with your settings:

```bash
# Server port (default: 3000)
PORT=3000

# CORS origin (frontend URL)
FRONTEND_URL=http://localhost:5173

# JWT secret (auto-generated if not set)
JWT_SECRET=your-secret-key

# Encryption key for API keys (auto-generated if not set)
CONFIG_SECRET=your-encryption-key

# Data directory (where catalogai.db is stored)
DATA_DIR=.
```

### Environment Variables Reference

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Backend server port |
| `FRONTEND_URL` | `http://localhost:5173` | Frontend URL for CORS |
| `JWT_SECRET` | auto-generated | Secret for JWT signing |
| `CONFIG_SECRET` | auto-generated | Encryption key for API keys |
| `DATA_DIR` | `.` | Directory for SQLite database |
| `NODE_ENV` | `development` | `development` or `production` |

### First Run

On first startup:
1. SQLite database (`catalogai.db`) is auto-created
2. If `JWT_SECRET` not set, random key file (`jwt.key`) is generated
3. If `CONFIG_SECRET` not set, random key file (`config.json.key`) is generated

## Running the Application

### Development Mode

Open **two terminals** and run one command in each:

**Terminal 1 - Backend:**
```bash
cd backend
npm run dev
```

Backend starts at http://localhost:3000

**Terminal 2 - Frontend:**
```bash
cd frontend
npm run dev
```

Frontend starts at http://localhost:5173

### First-Time Setup

1. Open http://localhost:5173 in your browser
2. Click "Registrar nuevo comercio" (Register new business)
3. Enter:
   - Business name (e.g., "My Store")
   - Admin username
   - Admin password (min 8 chars, uppercase, lowercase, number)
4. You're automatically logged in
5. Click the settings icon to configure PrestaShop and AI provider

### Production Build

**Backend:**
```bash
cd backend
npm run build      # Compile TypeScript to dist/
npm start          # Run the compiled server
```

**Frontend:**
```bash
cd frontend
npm run build      # Generate optimized static files to dist/
```

The frontend `dist/` folder contains static files you can deploy to any web server.

## Troubleshooting

### Port Conflicts

If port 3000 or 5173 is in use:

```bash
# Backend - use different port
PORT=3001 npm run dev

# Frontend - Vite will automatically try the next available port
```

### CORS Errors

Ensure `FRONTEND_URL` in `backend/.env` matches your frontend URL:
```bash
FRONTEND_URL=http://localhost:5173  # or your production URL
```

### Database Issues

The SQLite file (`catalogai.db`) is auto-created on startup.

**Reset database:**
```bash
rm backend/catalogai.db
rm backend/config.json.key  # optional, for fresh encryption key
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
