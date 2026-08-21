// Middleware that loads the comercio's config from the database into a
// per-request DataStore so every route handler sees the right config
// without any concurrency issues.

import { Request, Response, NextFunction } from 'express';
import { DataStore, normalizeAIConfig } from '../../store';
import { DatabasePersistence } from '../database-persistence/database-persistence';
import { verifyAccessToken } from './auth';

declare global {
  namespace Express {
    interface Request {
      store?: DataStore;
      configPersistence?: DatabasePersistence;
    }
  }
}

export function loadComercioConfig(req: Request, _res: Response, next: NextFunction): void {
  // Extract comercio_id from the JWT cookie directly so this middleware
  // works even when it runs before requireAuth (which sets req.user).
  const token = req.cookies?.access_token;
  if (!token) {
    return next();
  }

  let comercioId: number | undefined;
  try {
    const payload = verifyAccessToken(token);
    comercioId = payload.comercio_id;
  } catch {
    // Invalid/expired token – requireAuth will handle the error later.
    return next();
  }

  if (!comercioId) {
    return next();
  }

  const store = new DataStore();
  const persistence = new DatabasePersistence(comercioId);
  const persisted = persistence.load();
  if (persisted) {
    store.config = { ...persisted, ai: normalizeAIConfig(persisted.ai) };
  }

  req.store = store;
  req.configPersistence = persistence;
  next();
}
