// Main Express application setup

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { ErrorHandler } from './utils/error-handler';
import { DataStore, normalizeAIConfig } from './store';
import { createApiRouter, RouteDependencies } from './routes';
import { PrestaShopConfig } from './types';
import { PrestaShopClient } from './modules/prestashop-client/prestashop-client';
import { authRoutes, initDatabase } from './modules/auth';
import { loadComercioConfig } from './modules/auth/load-config-middleware';
import { DatabasePersistence } from './modules/database-persistence/database-persistence';

export interface CreateAppOptions {
  store?: DataStore;
  configFile?: string;
  configSecret?: string;
  prestashopClientFactory?: (config: PrestaShopConfig) => PrestaShopClient;
  dataDir?: string;
}

export default async function createApp(options: CreateAppOptions = {}) {
  const app = express();

  // Initialize user database
  const dataDir = options.dataDir || process.env.DATA_DIR || process.cwd();
  await initDatabase(dataDir);

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

  // CORS configuration
  app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true
  }));

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

  // Auth routes (unprotected – no user context yet)
  app.use('/api/auth', authRoutes);

  // Public status endpoint (before router to avoid auth middleware)
  app.get('/api/status', (_req, res) => {
    res.json({ success: true, message: 'Online' });
  });

  // Load per-comercio config from DB into req.store on every authenticated request
  app.use('/api', loadComercioConfig);

  // API routes – store/configPersistence are now per-request from middleware
  const routeDeps: RouteDependencies = {
    prestashopClientFactory: options.prestashopClientFactory
  };
  app.use('/api', createApiRouter(routeDeps));

  // Error handling middleware
  app.use(ErrorHandler.notFound);
  app.use(ErrorHandler.handle);

  return app;
}
