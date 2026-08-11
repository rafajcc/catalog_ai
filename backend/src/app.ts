// Main Express application setup

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { ErrorHandler } from './utils/error-handler';
import { DataStore } from './store';
import { createApiRouter, RouteDependencies } from './routes';
import { ConfigPersistence } from './modules/config-persistence/config-persistence';
import { PrestaShopConfig } from './types';
import { PrestaShopClient } from './modules/prestashop-client/prestashop-client';

export interface CreateAppOptions {
  store?: DataStore;
  configFile?: string;
  configSecret?: string;
  prestashopClientFactory?: (config: PrestaShopConfig) => PrestaShopClient;
}

export default function createApp(options: CreateAppOptions = {}) {
  const app = express();

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

  // API routes
  const store = options.store || new DataStore();

  let configPersistence: ConfigPersistence | undefined;
  const configFile = options.configFile || process.env.CONFIG_FILE;
  if (configFile) {
    configPersistence = new ConfigPersistence(configFile, options.configSecret || process.env.CONFIG_SECRET);
    const persisted = configPersistence.load();
    if (persisted) {
      store.config = persisted;
    }
  }

  const routeDeps: RouteDependencies = {
    store,
    prestashopClientFactory: options.prestashopClientFactory,
    configPersistence
  };
  app.use('/api', createApiRouter(routeDeps));

  app.get('/api/status', (_req, res) => {
    res.json({ success: true, message: 'Online' });
  });

  // Error handling middleware
  app.use(ErrorHandler.notFound);
  app.use(ErrorHandler.handle);

  return app;
}
