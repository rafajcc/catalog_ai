// Middleware that loads the comercio's config from the database into a
// per-request DataStore so every route handler sees the right config
// without any concurrency issues.

import { Request, Response, NextFunction } from 'express';
import { DataStore, normalizeAIConfig } from '../../store';
import { DatabasePersistence } from '../database-persistence/database-persistence';

declare global {
  namespace Express {
    interface Request {
      store?: DataStore;
      configPersistence?: DatabasePersistence;
    }
  }
}

export function loadComercioConfig(req: Request, _res: Response, next: NextFunction): void {
  const comercioId = req.user?.comercio_id;
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
