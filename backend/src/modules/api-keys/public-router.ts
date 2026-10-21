// Minimal public surface of the api-keys module.
//
// It currently exposes a single authenticated probe so a client can verify that
// its key works and that the backend resolved the right comercio before wiring
// the real endpoints. The full public API (autocomplete, quota, status) lives in
// its own router mounted next to this one; this probe stays as a cheap health/self
// check for the module/shop integration setup screens.

import { Request, Response, Router } from 'express';
import { requireApiKey } from './middleware';

const router = Router();

// GET a tiny authenticated payload: who the key belongs to and whether the store
// was resolved. No secrets, no config values, so it is safe to call from a plugin
// setup wizard.
router.get('/probe', requireApiKey, (req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      comercio_id: req.apiKey!.comercioId,
      key_id: req.apiKey!.id,
      has_store: Boolean(req.store)
    }
  });
});

export default router;
