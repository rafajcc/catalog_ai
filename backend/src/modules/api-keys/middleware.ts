// Express middleware: machine-to-machine authentication with a comercio API key.
//
// Companion to the cookie `requireAuth` middleware, but for external clients (the
// PrestaShop module, the Shopify app) that cannot hold a login session. It reads
// the key from an `Authorization: Bearer <key>` or `X-Api-Key` header, resolves
// the owning comercio and populates the SAME per-request `req.store` the cookie
// flow uses, so the public routes can reuse the existing autocomplete service,
// quota and image search without any change.
//
// Kept deliberately isolated from the cookie auth: it shares no token logic, only
// the database lookups and the config loader.

import { Request, Response, NextFunction } from 'express';
import { findComercioById, findActiveComercioApiKeyByHash, touchComercioApiKey, ComercioApiKeyRow } from '../auth/database';
import { loadStoreForComercio } from '../auth/load-config-middleware';
import { AppError } from '../../utils/error-handler';
import { getLogContext, withLogContext } from '../../utils/log-context';
import { hashApiKey } from './api-key';

declare global {
  namespace Express {
    interface Request {
      // Set by requireApiKey; carries the resolved key and its comercio.
      apiKey?: { id: number; comercioId: number };
    }
  }
}

// Pulls the raw key out of the two accepted headers. `Authorization: Bearer x`
// is the standard form; `X-Api-Key: x` is the convenience form many plugins use.
function extractApiKey(req: Request): string | null {
  const header = req.get('authorization');
  if (header) {
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (match) return match[1].trim();
  }
  const direct = req.get('x-api-key');
  if (direct && direct.trim()) return direct.trim();
  return null;
}

/**
 * Authenticates a request by API key. On success sets `req.apiKey` and `req.store`
 * (the comercio's config, exactly as a logged-in request would see it). Fails with
 * a single generic 401 for a missing, unknown, disabled or revoked key, so the
 * response never reveals whether a key ever existed.
 */
export function requireApiKey(req: Request, _res: Response, next: NextFunction): void {
  const raw = extractApiKey(req);
  if (!raw) {
    return next(new AppError('API key required', 401, undefined, 'invalid_api_key'));
  }

  const row = findActiveComercioApiKeyByHash(hashApiKey(raw));
  if (!row) {
    return next(new AppError('Invalid API key', 401, undefined, 'invalid_api_key'));
  }

  const comercio = findComercioById(row.comercio_id);
  if (!comercio || comercio.active !== 1) {
    return next(new AppError('Comercio is disabled', 403, undefined, 'comercio_disabled'));
  }

  // Best-effort usage stamp: a failure here must never block the request.
  try {
    touchComercioApiKey(row.id);
  } catch {
    /* ignore */
  }

  req.apiKey = { id: row.id, comercioId: row.comercio_id };

  const { store, persistence } = loadStoreForComercio(row.comercio_id);
  req.store = store;
  req.configPersistence = persistence;

  // Tag every log line of this request with the owning comercio (the API key has
  // no user). Preserve the requestId set by earlier middleware.
  const existing = getLogContext();
  withLogContext({ ...existing, comercioId: row.comercio_id, username: `api:${row.key_prefix}` }, () => {
    next();
  });
}
