// Super admin routes for comercio API keys: list the keys of a comercio, mint a
// new one and revoke an existing one. Only the super admin manages keys for now
// (the whole app is configured by it), so every route is mounted behind
// requireAuth + requireRole('superadmin').
//
// The plaintext secret leaves the backend exactly once, in the response of the
// POST that creates the key; afterwards only its prefix can be listed.

import { Request, Response, Router } from 'express';
import { AppError } from '../../utils/error-handler';
import { requireAuth, requireRole } from '../auth/middleware';
import {
  ComercioApiKeyRow,
  createComercioApiKey,
  findComercioById,
  listComercioApiKeys,
  revokeComercioApiKey
} from '../auth/database';
import { apiKeyPrefix, generateApiKey, hashApiKey } from './api-key';

const router = Router();

// A commerce id is required on every /:comercioId route.
function parseComercioId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new AppError('Invalid comercio id', 400);
  return id;
}

function requireExistingComercio(comercioId: number): string {
  const comercio = findComercioById(comercioId);
  if (!comercio) throw new AppError('Comercio not found', 404);
  return comercio.name;
}

// The safe shape of a key: never the hash, only the identifying prefix and the
// lifecycle timestamps.
function toPublicKey(row: ComercioApiKeyRow) {
  return {
    id: row.id,
    comercio_id: row.comercio_id,
    name: row.name,
    key_prefix: row.key_prefix,
    active: row.active === 1,
    revoked: row.revoked_at !== null,
    last_used_at: row.last_used_at,
    revoked_at: row.revoked_at,
    created_at: row.created_at
  };
}

// GET the keys of one comercio (active and revoked).
router.get('/:comercioId/keys', requireAuth, requireRole('superadmin'), (req: Request, res: Response) => {
  const comercioId = parseComercioId(String(req.params.comercioId));
  const comercioName = requireExistingComercio(comercioId);
  res.json({
    success: true,
    data: {
      comercio_id: comercioId,
      comercio_name: comercioName,
      keys: listComercioApiKeys(comercioId).map(toPublicKey)
    }
  });
});

// POST a new key. The `secret` is returned ONLY here and never stored (only its
// hash is persisted), so the caller must copy it now.
router.post('/:comercioId/keys', requireAuth, requireRole('superadmin'), (req: Request, res: Response) => {
  const comercioId = parseComercioId(String(req.params.comercioId));
  requireExistingComercio(comercioId);

  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (!name) throw new AppError('A name is required for the API key', 400);

  const secret = generateApiKey();
  const row = createComercioApiKey({
    comercioId,
    name,
    keyHash: hashApiKey(secret),
    keyPrefix: apiKeyPrefix(secret)
  });

  res.status(201).json({ success: true, data: { ...toPublicKey(row), secret } });
});

// DELETE (revoke) a key. The row is kept for the audit trail; it simply stops
// authenticating. 404 when it does not exist or was already revoked.
router.delete('/:comercioId/keys/:keyId', requireAuth, requireRole('superadmin'), (req: Request, res: Response) => {
  const comercioId = parseComercioId(String(req.params.comercioId));
  requireExistingComercio(comercioId);

  const keyId = Number(req.params.keyId);
  if (!Number.isInteger(keyId) || keyId <= 0) throw new AppError('Invalid key id', 400);

  if (!revokeComercioApiKey(keyId)) {
    throw new AppError('API key not found or already revoked', 404);
  }

  res.json({ success: true, data: { id: keyId, revoked: true } });
});

export default router;
