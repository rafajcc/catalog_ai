// Super admin routes for the image provider services: list/config/enable,
// round-robin reorder, billing reset and the provider feed images table.

import { NextFunction, Request, Response, Router } from 'express';
import { AppError } from '../../utils/error-handler';
import { requireAuth, requireRole } from '../auth/middleware';
import {
  addProviderFeedImage,
  countImageProviderAuditLog,
  deleteProviderFeedImage,
  findComercioById,
  getImageProviderBySlug,
  ImageProviderAuditFilters,
  ImageProviderAuditRow,
  IMAGE_PROVIDER_AUDIT_RETENTION_DAYS,
  ImageProviderRow,
  listImageProviderAuditLog,
  listImageProviders,
  listProviderFeedImages,
  resetImageProviderCalls,
  summariseImageProviderAuditLog,
  updateImageProvider
} from '../auth/database';
import { getImageProviderDefinition, IMAGE_PROVIDERS } from './registry';
import { cycleStartForDayOfMonth } from '../../utils/billing-cycle';
import { maskSecret } from '../../utils/mask';

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

// Public shape of a provider: credential values are NEVER exposed, only the
// has_* flags and masked hints so the UI can show who is configured.
function toPublicProvider(row: ImageProviderRow) {
  const definition = getImageProviderDefinition(row.slug);
  const config = parseConfig(row);
  const extra = (definition?.extraConfigFields ?? []).map((field) => {
    const value = String(config[field.key] ?? '').trim();
    return {
      key: field.key,
      label: field.label,
      configured: Boolean(value),
      value: value || null
    };
  });
  const apiKey = String(config.api_key ?? '');
  const username = String(config.username ?? '');
  const password = String(config.password ?? '');
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    enabled: row.enabled === 1,
    sort_order: row.sort_order,
    implemented: definition?.implemented ?? false,
    always_first: definition?.alwaysFirst ?? false,
    auth_kind: definition?.auth_kind ?? 'none',
    has_api_key: Boolean(apiKey.trim()),
    has_username: Boolean(username.trim()),
    has_password: Boolean(password.trim()),
    api_key_hint: maskSecret(apiKey),
    username_hint: maskSecret(username),
    password_hint: maskSecret(password),
    max_calls_per_month: String(config.max_calls_per_month ?? '') || null,
    extra_config: extra,
    calls_this_cycle: row.calls_this_cycle,
    billing_cycle_day: row.billing_cycle_day,
    cycle_start: row.cycle_start,
    last_called: row.last_called === 1
  };
}

const MAX_AUDIT_DAYS = IMAGE_PROVIDER_AUDIT_RETENTION_DAYS;
const AUDIT_SCREEN_LIMIT = 50;
const AUDIT_STATUSES = new Set(['ok', 'empty', 'error', 'quota']);

function parseAuditFilters(req: Request): ImageProviderAuditFilters {
  const from = typeof req.query.from === 'string' ? req.query.from : '';
  const to = typeof req.query.to === 'string' ? req.query.to : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    throw new AppError('from and to must be dates in YYYY-MM-DD format', 400);
  }
  const fromMs = Date.parse(`${from}T00:00:00`);
  const toMs = Date.parse(`${to}T00:00:00`);
  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) {
    throw new AppError('from and to must be real dates in YYYY-MM-DD format', 400);
  }
  if (toMs < fromMs) throw new AppError('to must not be earlier than from', 400);
  const days = Math.round((toMs - fromMs) / 86_400_000) + 1;
  if (days > MAX_AUDIT_DAYS) {
    throw new AppError(`The report range must not exceed ${MAX_AUDIT_DAYS} days`, 400);
  }

  const providerSlug = typeof req.query.provider === 'string' ? req.query.provider.trim() : '';
  if (providerSlug && !getImageProviderDefinition(providerSlug)) {
    throw new AppError('Unknown image provider', 400);
  }

  const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';
  if (status && !AUDIT_STATUSES.has(status)) {
    throw new AppError(`status must be one of: ${[...AUDIT_STATUSES].join(', ')}`, 400);
  }

  const comercioRaw = typeof req.query.comercio_id === 'string' ? req.query.comercio_id : '';
  let comercioId: number | null = null;
  if (comercioRaw) {
    const parsed = Number(comercioRaw);
    if (!Number.isInteger(parsed) || parsed <= 0) throw new AppError('Invalid comercio id', 400);
    if (!findComercioById(parsed)) throw new AppError('Comercio not found', 404);
    comercioId = parsed;
  }

  return {
    from,
    to,
    providerSlug: providerSlug || null,
    status: status || null,
    comercioId
  };
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

type AuditReportLang = 'es' | 'en';

const AUDIT_CSV_COLUMNS: {
  header: Record<AuditReportLang, string>;
  value: (row: ImageProviderAuditRow) => unknown;
}[] = [
  { header: { es: 'fecha_peticion', en: 'requested_at' }, value: (row) => row.requested_at },
  { header: { es: 'id_peticion', en: 'request_id' }, value: (row) => row.request_id },
  { header: { es: 'id_comercio', en: 'comercio_id' }, value: (row) => row.comercio_id },
  { header: { es: 'comercio', en: 'comercio_name' }, value: (row) => row.comercio_name },
  { header: { es: 'id_usuario', en: 'user_id' }, value: (row) => row.user_id },
  { header: { es: 'usuario', en: 'user_name' }, value: (row) => row.user_name },
  { header: { es: 'proveedor', en: 'provider' }, value: (row) => row.provider_slug },
  { header: { es: 'nombre_proveedor', en: 'provider_name' }, value: (row) => row.provider_name },
  { header: { es: 'estado', en: 'status' }, value: (row) => row.status },
  { header: { es: 'imagenes_solicitadas', en: 'requested_images' }, value: (row) => row.requested_images },
  { header: { es: 'imagenes_devueltas', en: 'urls_count' }, value: (row) => row.urls_count },
  { header: { es: 'duracion_ms', en: 'duration_ms' }, value: (row) => row.duration_ms },
  { header: { es: 'marca', en: 'brand' }, value: (row) => row.product_brand },
  { header: { es: 'referencia', en: 'reference' }, value: (row) => row.product_reference },
  { header: { es: 'ean', en: 'ean' }, value: (row) => row.product_ean },
  { header: { es: 'error', en: 'error' }, value: (row) => row.error_message }
];

function auditReportLang(req: Request): AuditReportLang {
  const requested = typeof req.query.lang === 'string' ? req.query.lang.trim().toLowerCase() : '';
  if (requested) return requested.startsWith('es') ? 'es' : 'en';
  const accepted = String(req.headers['accept-language'] ?? '').trim().toLowerCase();
  return accepted.startsWith('es') ? 'es' : 'en';
}

router.get('/', requireAuth, requireRole('superadmin'), (_req: Request, res: Response) => {
  res.json({ success: true, data: listImageProviders().map(toPublicProvider) });
});

router.get('/audit-log', requireAuth, requireRole('superadmin'), (req: Request, res: Response) => {
  const filters = parseAuditFilters(req);
  const rows = listImageProviderAuditLog({ ...filters, limit: AUDIT_SCREEN_LIMIT });
  const total = countImageProviderAuditLog(filters);
  const summary = summariseImageProviderAuditLog(filters);
  res.json({
    success: true,
    data: {
      rows,
      total,
      limit: AUDIT_SCREEN_LIMIT,
      summary,
      providers: IMAGE_PROVIDERS.filter((provider) => provider.implemented).map(({ slug, name }) => ({ slug, name }))
    }
  });
});

router.get('/audit-log.csv', requireAuth, requireRole('superadmin'), (req: Request, res: Response) => {
  const filters = parseAuditFilters(req);
  const lang = auditReportLang(req);
  const rows = listImageProviderAuditLog(filters);
  const lines = [AUDIT_CSV_COLUMNS.map((column) => column.header[lang]).join(',')];
  for (const row of rows) {
    lines.push(AUDIT_CSV_COLUMNS.map((column) => csvCell(column.value(row))).join(','));
  }

  const fileName =
    `image-provider-audit-${filters.providerSlug || 'all'}-${filters.from}-${filters.to}.csv`.replace(
      /[^a-zA-Z0-9._-]/g,
      '_'
    );
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.send('\uFEFF' + lines.join('\r\n') + '\r\n');
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