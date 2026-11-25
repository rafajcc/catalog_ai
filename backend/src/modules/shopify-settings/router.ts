// Super admin routes for the global Shopify app credentials. These settings
// are platform-wide: comercios never send the Client ID or Client Secret, and
// the secret is returned only as a masked hint.

import { Request, Response, Router } from 'express';
import { requireAuth, requireRole } from '../auth/middleware';
import { loadShopifyGlobalSettings, saveShopifyGlobalSettings, toPublicShopifyGlobalSettings } from './global-shopify';

const router = Router();

router.get('/', requireAuth, requireRole('superadmin'), (_req: Request, res: Response) => {
  res.json({ success: true, data: toPublicShopifyGlobalSettings(loadShopifyGlobalSettings()) });
});

router.put('/', requireAuth, requireRole('superadmin'), (req: Request, res: Response) => {
  const data = saveShopifyGlobalSettings(req.body ?? {});
  res.json({
    success: true,
    message: 'Configuración global de Shopify guardada',
    data
  });
});

export default router;
