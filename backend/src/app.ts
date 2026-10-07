// Main Express application setup

import express from 'express';
import type { Response } from 'express';
import path from 'path';
import fs from 'fs';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { ErrorHandler } from './utils/error-handler';
import { DataStore } from './store';
import { createApiRouter, RouteDependencies } from './routes';
import { PrestaShopConfig } from './types';
import { PrestaShopClient } from './modules/prestashop-client/prestashop-client';
import { authRoutes, initDatabase } from './modules/auth';
import { loadComercioConfig } from './modules/auth/load-config-middleware';
import { seedImageProviders } from './modules/image-providers/registry';
// The app version comes from the ROOT package.json (the single source of
// truth: `npm run sync:version` propagates it to the backend/frontend
// package.json files, the lock files and the docs). `__dirname` is
// backend/src at build time and backend/dist at runtime, so ../.. lands on the
// repository root in both cases.
import pkg from '../../package.json';

export interface CreateAppOptions {
  store?: DataStore;
  configFile?: string;
  configSecret?: string;
  prestashopClientFactory?: (config: PrestaShopConfig) => PrestaShopClient;
  dataDir?: string;
}

export default async function createApp(options: CreateAppOptions = {}) {
  const app = express();

  // The app runs behind a reverse proxy (e.g. Railway), so req.protocol and
  // req.ip must honor the X-Forwarded-* headers for correct origins and rate
  // limiting. '1' trusts a single front-facing proxy.
  app.set('trust proxy', 1);

  // Initialize user database
  const dataDir = options.dataDir || process.env.DATA_DIR || process.cwd();
  await initDatabase(dataDir);

  // Seed the image provider services (idempotent; keeps existing rows).
  seedImageProviders();

  // Security middleware
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'", "https://api.openai.com"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'"],
        frameSrc: ["'none'"],
      }
    }
  }));

  // CORS configuration – disabled in production (same-origin), enabled in dev
  if (process.env.NODE_ENV !== 'production') {
    app.use(cors({
      origin: process.env.FRONTEND_URL || 'http://localhost:5173',
      credentials: true
    }));
  }

  // Rate limiting
  const limiter = rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'),
    max: parseInt(process.env.RATE_LIMIT_MAX || '100'),
    message: 'Too many requests from this IP, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use('/api/', limiter);

  // Body parsing middleware
  app.use(express.json({ limit: process.env.MAX_BODY_SIZE || '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: process.env.MAX_BODY_SIZE || '10mb' }));
  app.use(cookieParser());

  // Load per-comercio config from DB into req.store on auth routes too, so
  // /auth/me can report the real configuration state (PrestaShop/AI configured).
  app.use('/api/auth', loadComercioConfig);

  // Auth routes (unprotected – no user context yet)
  app.use('/api/auth', authRoutes);

  // Public status endpoint (before router to avoid auth middleware).
  // `env` is APP_ENV (production unless the server sets APP_ENV=test).
  app.get('/api/status', (_req, res) => {
    res.json({ success: true, message: 'Online', version: pkg.version, env: process.env.APP_ENV || 'production' });
  });

  // Load per-comercio config from DB into req.store on every authenticated request
  app.use('/api', loadComercioConfig);

  // API routes – store/configPersistence are now per-request from middleware
  const routeDeps: RouteDependencies = {
    prestashopClientFactory: options.prestashopClientFactory
  };
  app.use('/api', createApiRouter(routeDeps));

  // Serve frontend static files in production
  const publicDir = path.join(__dirname, '..', 'public');
  if (fs.existsSync(publicDir)) {
    const indexPath = path.join(publicDir, 'index.html');
    if (fs.existsSync(indexPath)) {
      // index.html reaches the client through three routes (/, /index.html and
      // the SPA fallback), so the test label goes through this one helper.
      // Production keeps sendFile (byte for byte as before); only APP_ENV=test
      // reads the file to rewrite the meta the header reads and the tab title,
      // which is what lets a single build serve every environment.
      const serveIndex = (res: Response) => {
        if (process.env.APP_ENV !== 'test') {
          res.sendFile(indexPath);
          return;
        }
        const html = fs
          .readFileSync(indexPath, 'utf8')
          .replace('<meta name="app-env" content="production"', '<meta name="app-env" content="test"')
          .replace('<title>', '<title>Test ');
        res.type('html').send(html);
      };

      app.get('/', (_req, res) => serveIndex(res));
      app.get('/index.html', (_req, res) => serveIndex(res));
      app.use(express.static(publicDir));

      // SPA fallback – return index.html for non-API, non-file routes
      app.get('*', (req, res, next) => {
        if (req.path.startsWith('/api/')) return next();
        serveIndex(res);
      });
    } else {
      app.use(express.static(publicDir));
    }
  }

  // Error handling middleware
  app.use(ErrorHandler.notFound);
  app.use(ErrorHandler.handle);

  return app;
}
