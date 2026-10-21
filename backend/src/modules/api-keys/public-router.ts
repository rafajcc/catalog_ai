// Public API for external clients (the PrestaShop module / the Shopify app).
//
// Every route is authenticated with a comercio API key (`requireApiKey`), which
// resolves the owning comercio and populates the same per-request `req.store`
// the web app uses. The heavy lifting is NOT reimplemented here: autocomplete
// goes through `runAutocomplete`, the exact service the internal
// POST /api/autocomplete uses, so quota accounting, image-provider billing and
// the audit log behave identically for both surfaces.
//
// The comercio is taken from the key, never from the request body: a client can
// only ever act on its own comercio.

import { Request, Response, Router } from 'express';
import { requireApiKey } from './middleware';
import { runAutocomplete, validateAutocompleteInput } from '../autocomplete/autocomplete-service';
import { generateRequestId } from '../ai-text-suggester/ai-text-suggester';
import { getLogContext } from '../../utils/log-context';
import { ImageSearcher } from '../image-providers/types';
import { QUOTA_DISABLED, QUOTA_UNLIMITED } from '../autocomplete-quota/quota';
import { ensureAutocompleteQuota } from '../auth/database';
import { cycleStartForDayOfMonth } from '../../utils/billing-cycle';
import {
  createPublicComercioLimiter,
  createPublicIpLimiter,
  publicComercioLimiter,
  publicIpLimiter
} from './rate-limit';
import pkg from '../../../../package.json';

export interface PublicApiDependencies {
  // Image search port, injected by app.ts so this router never imports the
  // concrete engine or the database. Same dependency the internal route uses.
  imageSearcher: ImageSearcher;
  // Test-only: swap the rate limiters for ones with a tiny ceiling so the 429
  // path is exercised without hammering the real 60/min bucket. Production and
  // every other caller use the shared instances.
  ipLimiter?: ReturnType<typeof createPublicIpLimiter>;
  comercioLimiter?: ReturnType<typeof createPublicComercioLimiter>;
}

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: (err?: unknown) => void): void => {
    fn(req, res).catch(next);
  };

// Public shape of a quota: the -1/0 conventions are resolved into flags so a
// client does not have to know them, and `remaining` is null when unlimited.
function toPublicQuota(comercioId: number) {
  const row = ensureAutocompleteQuota(comercioId);
  const unlimited = row.monthly_limit === QUOTA_UNLIMITED;
  const disabled = row.monthly_limit === QUOTA_DISABLED;
  // Roll the period forward in the answer without writing: a client asking for
  // its quota must see the current period even if no call was made yet this one.
  const currentStart = cycleStartForDayOfMonth(row.billing_cycle_day || 1);
  const callsThisCycle = row.cycle_start && row.cycle_start < currentStart ? 0 : row.calls_this_cycle;
  return {
    monthly_limit: row.monthly_limit,
    unlimited,
    disabled,
    billing_cycle_day: row.billing_cycle_day,
    calls_this_cycle: callsThisCycle,
    remaining: unlimited || disabled ? (disabled ? 0 : null) : Math.max(0, row.monthly_limit - callsThisCycle),
    cycle_start: row.cycle_start && row.cycle_start < currentStart ? currentStart : row.cycle_start
  };
}

export function createPublicApiRouter(deps: PublicApiDependencies): Router {
  const router = Router();
  const ipLimiter = deps.ipLimiter ?? publicIpLimiter;
  const comercioLimiter = deps.comercioLimiter ?? publicComercioLimiter;

  // First layer, before the key is known: an IP-keyed ceiling that blunts
  // brute-force guessing of API keys (no valid comercio exists yet to key on).
  router.use(ipLimiter);

  // Identity probe: lets the plugin/shop setup wizard verify that a key works
  // and which comercio it belongs to. No secrets, no config values.
  router.get('/probe', requireApiKey, comercioLimiter, (req: Request, res: Response) => {
    res.json({
      success: true,
      data: {
        comercio_id: req.apiKey!.comercioId,
        key_id: req.apiKey!.id,
        has_store: Boolean(req.store)
      }
    });
  });

  // Version/health of the public API so a client can check it reached the right
  // deployment. Only non-sensitive values: the app version and the identity
  // (comercio id) the key resolves to — never the comercio name or any config.
  router.get('/status', requireApiKey, comercioLimiter, (req: Request, res: Response) => {
    res.json({
      success: true,
      data: {
        online: true,
        version: pkg.version,
        comercio_id: req.apiKey!.comercioId
      }
    });
  });

  // Remaining autocomplete quota of the comercio that owns the key. The comercio
  // shares the SAME monthly allowance as its users in the web app.
  router.get('/quota', requireApiKey, comercioLimiter, (req: Request, res: Response) => {
    res.json({ success: true, data: toPublicQuota(req.apiKey!.comercioId) });
  });

  // Autocomplete of one product: AI proposals for the empty text fields plus the
  // missing product images. Delegates to `runAutocomplete`, so the quota is
  // reserved/consumed and the audit row written exactly as in the web app. The
  // 429 over-quota error and the 503 no-AI-config error travel unchanged.
  router.post(
    '/autocomplete',
    requireApiKey,
    comercioLimiter,
    wrap(async (req: Request, res: Response) => {
      // Same lightweight contract the web route enforces, so a malformed product
      // is rejected identically on both surfaces.
      const { product, language } = validateAutocompleteInput({
        product: (req.body ?? {}).product,
        language: req.body?.language
      });

      const comercioId = req.apiKey!.comercioId;
      const origin = `${req.protocol}://${req.get('host')}`;
      const requestId = (req as any).requestId || getLogContext().requestId || generateRequestId();

      const data = await runAutocomplete({
        product,
        language,
        ai: req.store!.config.ai,
        searchImages: deps.imageSearcher,
        comercioId,
        // The API key stands for the comercio at machine level: there is no user,
        // so the audit/usage is attributed to user 0 (the comercio itself) and
        // the image-search logs are tagged with the key prefix.
        userId: 0,
        comercioName: `api:${req.apiKey!.id}`,
        origin,
        requestId
      });

      res.json({ success: true, data });
    })
  );

  return router;
}

export default createPublicApiRouter;
