// Super admin routes for the platform-wide marketplace switch: list every
// marketplace and enable/disable it for the whole application. Disabling a
// marketplace does NOT reassign the comercios that already had it as their
// active one; they keep the value but cannot operate until they pick another,
// which is why the update reports back which comercios are affected.

import { Request, Response, Router } from 'express';
import { AppError } from '../../utils/error-handler';
import { requireAuth, requireRole } from '../auth/middleware';
import {
  listAllMarketplaces,
  findGlobalMarketplaceByName,
  setMarketplaceEnabled,
  listComerciosUsingMarketplace
} from '../auth/database';
import { isRegisteredMarketplace, getMarketplaceLabel } from './adapters/registry';

const router = Router();

function toPublicMarketplace(row: { id: number; name: string; enabled: number }) {
  const name = row.name;
  return {
    id: row.id,
    name,
    label: isRegisteredMarketplace(name) ? getMarketplaceLabel(name) : name,
    enabled: row.enabled === 1,
    in_use_by: listComerciosUsingMarketplace(name)
  };
}

router.get('/', requireAuth, requireRole('superadmin'), (_req: Request, res: Response) => {
  res.json({ success: true, data: listAllMarketplaces().map(toPublicMarketplace) });
});

// Enables or disables a marketplace platform-wide. When disabling, the affected
// comercios are returned so the UI can ask for confirmation beforehand; the
// switch is applied regardless once the request reaches here (the confirmation
// lives in the client).
router.put('/:name', requireAuth, requireRole('superadmin'), (req: Request, res: Response) => {
  const name = String(req.params.name ?? '');
  if (!isRegisteredMarketplace(name)) {
    throw new AppError('Unknown marketplace', 400);
  }
  if (!findGlobalMarketplaceByName(name)) {
    throw new AppError('Marketplace not found', 404);
  }
  const enabled = req.body?.enabled;
  if (typeof enabled !== 'boolean') {
    throw new AppError('enabled must be a boolean', 400);
  }
  const affected = enabled ? [] : listComerciosUsingMarketplace(name);
  setMarketplaceEnabled(name, enabled);
  res.json({
    success: true,
    message: enabled ? `Marketplace activado: ${name}` : `Marketplace desactivado: ${name}`,
    data: { name, enabled, affected_comercios: affected }
  });
});

export default router;
