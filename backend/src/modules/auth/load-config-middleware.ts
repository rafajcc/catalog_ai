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

// One DataStore per comercio, reused across requests so that in-memory state
// (e.g. prestashopDataset / shopifyDataset) persists between the POST that
// fetches products and the GET that reads them.
const storeByComercio = new Map<number, DataStore>();

// Reuse the existing store for this comercio, or create a new one.
function storeForComercio(comercioId: number): DataStore {
  let store = storeByComercio.get(comercioId);
  if (!store) {
    store = new DataStore();
    storeByComercio.set(comercioId, store);
  }
  return store;
}

// Loads the persisted config of a comercio into its in-memory store and returns
// both. Shared by the cookie middleware below and the API-key middleware, so a
// machine-to-machine request sees exactly the config a logged-in user would.
export function loadStoreForComercio(comercioId: number): { store: DataStore; persistence: DatabasePersistence } {
  const store = storeForComercio(comercioId);
  // Reload persisted config on every request so saves are immediately visible.
  const persistence = new DatabasePersistence(comercioId);
  const persisted = persistence.load();
  if (persisted) {
    store.config = { ...persisted, ai: normalizeAIConfig(persisted.ai) };
  }
  return { store, persistence };
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

  const { store, persistence } = loadStoreForComercio(comercioId);
  req.store = store;
  req.configPersistence = persistence;
  next();
}

// Drops the in-memory working datasets (the products loaded from each
// marketplace) of one comercio, so they never leak into the next session. The
// persisted config is kept — it is reloaded from the database on every request
// anyway.
export function clearComercioDataStore(comercioId: number): void {
  const store = storeByComercio.get(comercioId);
  if (store) {
    store.clearDatasets();
  }
}
