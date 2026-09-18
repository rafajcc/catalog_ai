// Super admin routes for the image provider services: list/config/enable,
// round-robin reorder, billing reset and the provider feed images table.

import { NextFunction, Request, Response, Router } from 'express';
import { AppError } from '../../utils/error-handler';
import { requireAuth, requireRole } from '../auth/middleware';
import {
  addProviderFeedImage,
  deleteProviderFeedImage,
  getImageProviderBySlug,
  ImageProviderRow,
  listImageProviders,
  listProviderFeedImages,
  resetImageProviderCalls,
  updateImageProvider
} from '../auth/database';
import { getImageProviderDefinition, IMAGE_PROVIDERS } from './registry';
import { cycleStartForDayOfMonth } from './services/engine';

const router = Router();

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

const wrap = (fn: AsyncHandler) => (req: Request, res: Response, next: NextFunction): void => {
  fn(req, res, next).catch(next);
};

function parseConfig(row: ImageProviderRow): Record<string, unknown> {
  try {
    const parsed = JSON.parse(row.config);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

// Public shape of a provider: credential values are NEVER exposed, only
// has_* flags so the UI knows who is configured.
function toPublicProvider(row: ImageProviderRow) {
  const definition = getImageProviderDefinition(row.slug);
  const config = parseConfig(row);
  const extra = (definition?.extraConfigFields ?? []).map((field) => ({
    key: field.key,
    label: field.label,
    configured: Boolean(String(config[field.key] ?? '').trim())
  }));
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    enabled: row.enabled === 1,
    sort_order: row.sort_order,
    implemented: definition?.implemented ?? false,
    auth_kind: definition?.auth_kind ?? 'none',
    has_api_key: Boolean(String(config.api_key ?? '').trim()),
    has_username: Boolean(String(config.username ?? '').trim()),
    has_password: Boolean(String(config.password ?? '').trim()),
    max_calls_per_month: String(config.max_calls_per_month ?? '') || null,
    extra_config: extra,
    calls_this_cycle: row.calls_this_cycle,
    billing_cycle_day: row.billing_cycle_day,
    cycle_start: row.cycle_start,
    last_called: row.last_called === 1
  };
}

router.get('/', requireAuth, requireRole('superadmin'), (_req: Request, res: Response) => {
  res.json({ success: true, data: listImageProviders().map(toPublicProvider) });
});

// Batch reorder of the round-robin order. Declared before /:slug so it is
// matched first. The body must list every provider slug once.
router.put('/reorder', requireAuth, requireRole('superadmin'), (req: Request, res: Response) => {
  const orderedSlugs = Array.isArray(req.body?.ordered_slugs) ? (req.body.ordered_slugs as string[]) : [];
  const existing = listImageProviders();

  const expected = new Set(existing.map((row) => row.slug));
  const received = new Set(orderedSlugs);
  if (orderedSlugs.length !== existing.length || expected.size !== received.size || [...expected].some((slug) => !received.has(slug))) {
    throw new AppError('ordered_slugs must list exactly the existing provider slugs', 400);
  }

  orderedSlugs.forEach((slug, index) => {
    updateImageProvider(slug, { sort_order: index });
  });

  res.json({ success: true, message: `${orderedSlugs.length} providers reordered` });
});

router.get('/feeds', requireAuth, requireRole('superadmin'), (req: Request, res: Response) => {
  const search = typeof req.query.search === 'string' ? req.query.search : '';
  res.json({ success: true, data: listProviderFeedImages(search).slice(0, 500) });
});

router.post('/feeds', requireAuth, requireRole('superadmin'), (req: Request, res: Response) => {
  const body = req.body ?? {};
  const brand = typeof body.brand === 'string' ? body.brand.trim() : '';
  const imageUrl = typeof body.image_url === 'string' ? body.image_url.trim() : '';
  if (!brand) throw new AppError('brand is required', 400);
  if (!imageUrl) throw new AppError('image_url is required', 400);
  if (!/^https?:\/\//i.test(imageUrl)) throw new AppError('image_url must be an absolute http(s) URL', 400);

  const row = addProviderFeedImage({
    brand,
    reference: typeof body.reference === 'string' ? body.reference : null,
    ean: typeof body.ean === 'string' ? body.ean : null,
    image_url: imageUrl
  });
  res.json({ success: true, data: row });
});

router.delete('/feeds/:id', requireAuth, requireRole('superadmin'), (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new AppError('Invalid feed image id', 400);
  if (!deleteProviderFeedImage(id)) throw new AppError('Feed image not found', 404);
  res.json({ success: true });
});

// Manual billing-cycle reset (also used by the UI when the cycle day changes).
router.post('/:slug/reset-calls', requireAuth, requireRole('superadmin'), (req: Request, res: Response) => {
  const slug = String(req.params.slug);
  const row = getImageProviderBySlug(slug);
  if (!row) throw new AppError('Image provider not found', 404);
  const cycleStart = row.billing_cycle_day ? cycleStartForDayOfMonth(row.billing_cycle_day) : null;
  resetImageProviderCalls(slug, cycleStart);
  res.json({ success: true, message: `Billing counter of ${slug} reset` });
});

// Update an existing provider: config merge ("key" => overwrite, '' => keep,
// null => delete), enable/disable, billing cycle day and optional counter reset.
router.put('/:slug', requireAuth, requireRole('superadmin'), (req: Request, res: Response) => {
  const slug = String(req.params.slug);
  const row = getImageProviderBySlug(slug);
  if (!row) throw new AppError('Image provider not found', 404);
  const definition = getImageProviderDefinition(slug);
  if (!definition) throw new AppError('Image provider not registered', 500);

  const body = req.body ?? {};
  const fields: Record<string, unknown> = {};

  if (typeof body.enabled === 'boolean') {
    if (body.enabled && !definition.implemented) {
      throw new AppError('Este servicio todavía no está implementado y no puede activarse', 400);
    }
    fields.enabled = body.enabled;
  }
  if (typeof body.name === 'string' && body.name.trim() && body.name.trim() !== row.name) {
    fields.name = body.name.trim();
  }

  // Config merge: copy the stored config, then apply the keys the client sent.
  if (body.config && typeof body.config === 'object' && !Array.isArray(body.config)) {
    const config = { ...parseConfig(row) };
    for (const [key, value] of Object.entries(body.config)) {
      if (value === null) {
        delete config[key];
      } else if (typeof value === 'string' && value.trim() !== '') {
        config[key] = value.trim();
      }
      // Empty string means "leave it as it was".
    }
    fields.config = config;
  }

  let nextBillingDay: number | null | undefined;
  if (body.billing_cycle_day === null) {
    fields.billing_cycle_day = null;
    nextBillingDay = null;
  } else if (typeof body.billing_cycle_day === 'number' && Number.isInteger(body.billing_cycle_day)) {
    const day = Math.max(1, Math.min(28, body.billing_cycle_day));
    fields.billing_cycle_day = day;
    nextBillingDay = day;
  }

  const updated = updateImageProvider(slug, fields);

  // Reset the billing counter when asked explicitly, or when the cycle day
  // changed (the counters belong to the old cycle).
  const wantsReset = body.reset_calls === true;
  if (updated && wantsReset) {
    const cycleStart = nextBillingDay ?? (getImageProviderBySlug(slug)?.billing_cycle_day as number | null) ?? null;
    resetImageProviderCalls(slug, cycleStart ? cycleStartForDayOfMonth(cycleStart) : null);
  }

  const fresh = getImageProviderBySlug(slug);
  res.json({ success: true, data: fresh ? toPublicProvider(fresh) : null, definitions_count: IMAGE_PROVIDERS.length });
});

export default router;