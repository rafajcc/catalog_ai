// Super admin routes for the per-comercio autocomplete quota and its audit
// report: read/update the settings of each comercio, reset the counter of the
// current period and download the CSV report of consumed calls.

import { Request, Response, Router } from 'express';
import { AppError } from '../../utils/error-handler';
import { requireAuth, requireRole } from '../auth/middleware';
import {
  AutocompleteAuditRow,
  AutocompleteQuotaRow,
  countAutocompleteAuditLog,
  findComercioById,
  getAutocompleteQuota,
  listAutocompleteAuditLog,
  listAutocompleteQuotas,
  resetAutocompleteQuotaCalls
} from '../auth/database';
import { cycleStartForDayOfMonth } from '../image-providers/services/engine';
import {
  applyAutocompleteQuotaSettings,
  MAX_BILLING_CYCLE_DAY,
  normaliseBillingCycleDay,
  normaliseMonthlyLimit,
  QUOTA_DISABLED,
  QUOTA_UNLIMITED
} from './quota';

const router = Router();

// A report longer than this is rejected: the report is meant to answer a
// billing question, not to dump the whole history.
const MAX_REPORT_DAYS = 30;

// Public shape of a quota row. `unlimited` is derived so the UI does not have to
// re-implement the -1 convention, and `remaining` is null when unlimited.
function toPublicQuota(row: AutocompleteQuotaRow & { comercio_name?: string }) {
  const unlimited = row.monthly_limit === QUOTA_UNLIMITED;
  return {
    comercio_id: row.comercio_id,
    comercio_name: row.comercio_name ?? '',
    monthly_limit: row.monthly_limit,
    unlimited,
    billing_cycle_day: row.billing_cycle_day,
    calls_this_cycle: row.calls_this_cycle,
    remaining: unlimited ? null : Math.max(0, row.monthly_limit - row.calls_this_cycle),
    cycle_start: row.cycle_start,
    updated_at: row.updated_at
  };
}

// A commerce id is required on every /:comercioId route.
function parseComercioId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new AppError('Invalid comercio id', 400);
  return id;
}

// Validates that the comercio exists before touching its quota, so a typo in the
// URL does not silently create a row for a comercio that does not exist. Returns
// the nombre to answer with, so every response carries it.
function requireExistingComercio(comercioId: number): string {
  const comercio = findComercioById(comercioId);
  if (!comercio) throw new AppError('Comercio not found', 404);
  return comercio.name;
}

// The saved quota of a comercio, or the defaults it would have if it had never
// been configured (autocomplete disabled).
function quotaOf(comercioId: number): AutocompleteQuotaRow {
  return (
    getAutocompleteQuota(comercioId) ?? {
      comercio_id: comercioId,
      monthly_limit: QUOTA_DISABLED,
      billing_cycle_day: 1,
      calls_this_cycle: 0,
      cycle_start: null,
      created_at: '',
      updated_at: ''
    }
  );
}

// GET every comercio with its quota and how much of the period is left.
router.get('/', requireAuth, requireRole('superadmin'), (_req: Request, res: Response) => {
  res.json({ success: true, data: listAutocompleteQuotas().map(toPublicQuota) });
});

// Update the limit / billing cycle day of one comercio. Changing the cycle day
// restarts the period, so the saved counter always belongs to the saved cycle.
router.put('/:comercioId', requireAuth, requireRole('superadmin'), (req: Request, res: Response) => {
  const comercioId = parseComercioId(String(req.params.comercioId));
  const comercioName = requireExistingComercio(comercioId);

  const body = req.body ?? {};
  if (body.monthly_limit === undefined) {
    throw new AppError('monthly_limit is required', 400);
  }
  const monthlyLimit = normaliseMonthlyLimit(body.monthly_limit);
  if (monthlyLimit === null) {
    throw new AppError('monthly_limit must be -1 (unlimited), 0 (disabled) or a positive number of calls', 400);
  }
  const billingCycleDay = normaliseBillingCycleDay(body.billing_cycle_day ?? 1);
  if (billingCycleDay === null) {
    throw new AppError(`billing_cycle_day must be an integer between 1 and ${MAX_BILLING_CYCLE_DAY}`, 400);
  }

  const updated = applyAutocompleteQuotaSettings(comercioId, {
    monthly_limit: monthlyLimit,
    billing_cycle_day: billingCycleDay
  });

  res.json({ success: true, data: toPublicQuota({ ...updated, comercio_name: comercioName }) });
});

// Zero the counter of the current period without touching the settings.
router.post('/:comercioId/reset-calls', requireAuth, requireRole('superadmin'), (req: Request, res: Response) => {
  const comercioId = parseComercioId(String(req.params.comercioId));
  const comercioName = requireExistingComercio(comercioId);
  const cycleStart = cycleStartForDayOfMonth(quotaOf(comercioId).billing_cycle_day || 1);
  resetAutocompleteQuotaCalls(comercioId, cycleStart);
  const fresh = getAutocompleteQuota(comercioId)!;
  res.json({ success: true, data: toPublicQuota({ ...fresh, comercio_name: comercioName }) });
});

// Parses and validates the report filters. Both dates are required and the range
// may not exceed 30 days, so a report can always be produced quickly.
function parseReportFilters(req: Request): { comercioId: number | null; from: string; to: string } {
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
  if (toMs < fromMs) {
    throw new AppError('to must not be earlier than from', 400);
  }
  const days = Math.round((toMs - fromMs) / 86_400_000) + 1;
  if (days > MAX_REPORT_DAYS) {
    throw new AppError(`The report range must not exceed ${MAX_REPORT_DAYS} days`, 400);
  }

  const comercioRaw = typeof req.query.comercio_id === 'string' ? req.query.comercio_id : '';
  let comercioId: number | null = null;
  if (comercioRaw) {
    comercioId = parseComercioId(comercioRaw);
    requireExistingComercio(comercioId);
  }
  return { comercioId, from, to };
}

// The report as JSON, used by the table shown on screen. The table shows only
// the newest AUDIT_SCREEN_LIMIT rows (no pagination in the panel), and `total`
// tells the super admin how many calls the period really has, so a truncated
// table is never read as the whole period. The CSV always carries every row.
const AUDIT_SCREEN_LIMIT = 50;

router.get('/audit-log', requireAuth, requireRole('superadmin'), (req: Request, res: Response) => {
  const filters = parseReportFilters(req);
  const rows = listAutocompleteAuditLog({ ...filters, limit: AUDIT_SCREEN_LIMIT });
  const total = countAutocompleteAuditLog(filters);
  res.json({ success: true, data: { rows, total, limit: AUDIT_SCREEN_LIMIT } });
});

// The same report as a CSV file. Values are quoted and internal quotes doubled
// so a brand or reference containing a comma, a quote or a newline cannot break
// the columns of the spreadsheet.
function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

// The same report as a CSV file. Every id travels next to its name, so the file
// can be read on its own (and joined) without guessing what "3" or "7" mean; the
// rest of the evidence stays as it was. The column names follow the language the
// report was asked for, so a super admin working in Spanish gets a file whose
// headers are also Spanish.
type ReportLang = 'es' | 'en';

const CSV_COLUMNS: { header: Record<ReportLang, string>; value: (row: AutocompleteAuditRow) => unknown }[] = [
  { header: { es: 'id_comercio', en: 'comercio_id' }, value: (row) => row.comercio_id },
  { header: { es: 'comercio', en: 'comercio_name' }, value: (row) => row.comercio_name },
  { header: { es: 'id_usuario', en: 'user_id' }, value: (row) => row.user_id },
  { header: { es: 'usuario', en: 'user_name' }, value: (row) => row.user_name },
  { header: { es: 'id_proveedor_ia', en: 'ai_provider_id' }, value: (row) => row.ai_provider_id },
  { header: { es: 'proveedor_ia', en: 'ai_provider_name' }, value: (row) => row.ai_provider_name },
  { header: { es: 'estado', en: 'status' }, value: (row) => row.status },
  { header: { es: 'marca', en: 'brand' }, value: (row) => row.product_brand },
  { header: { es: 'referencia', en: 'reference' }, value: (row) => row.product_reference },
  { header: { es: 'ean', en: 'ean' }, value: (row) => row.product_ean },
  { header: { es: 'fecha_peticion', en: 'requested_at' }, value: (row) => row.requested_at }
];

// The language of the column names: the explicit `lang` the frontend sends (the
// language selected in the app) wins, and Accept-Language is the fallback for a
// report downloaded straight from the browser or from curl.
function reportLang(req: Request): ReportLang {
  const requested = typeof req.query.lang === 'string' ? req.query.lang.trim().toLowerCase() : '';
  if (requested) return requested.startsWith('es') ? 'es' : 'en';
  const accepted = String(req.headers['accept-language'] ?? '').trim().toLowerCase();
  return accepted.startsWith('es') ? 'es' : 'en';
}

router.get('/audit-log.csv', requireAuth, requireRole('superadmin'), (req: Request, res: Response) => {
  const filters = parseReportFilters(req);
  const lang = reportLang(req);
  const rows = listAutocompleteAuditLog(filters);
  const lines = [CSV_COLUMNS.map((column) => column.header[lang]).join(',')];
  for (const row of rows) {
    lines.push(CSV_COLUMNS.map((column) => csvCell(column.value(row))).join(','));
  }

  const comercio = filters.comercioId
    ? listAutocompleteQuotas().find((row) => row.comercio_id === filters.comercioId)?.comercio_name ?? ''
    : 'all';
  const fileName = `autocomplete-audit-${comercio || 'all'}-${filters.from}-${filters.to}.csv`.replace(
    /[^a-zA-Z0-9._-]/g,
    '_'
  );

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  // The BOM makes Excel open the file as UTF-8, so accented brands show up
  // correctly instead of as mojibake.
  res.send('\uFEFF' + lines.join('\r\n') + '\r\n');
});

export default router;