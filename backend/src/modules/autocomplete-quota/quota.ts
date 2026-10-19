// Per-comercio quota for the AI autocomplete button.
//
// The counter has two jobs that pull in opposite directions:
//
//  1. It must be accurate: a call only counts when the AI actually answered with
//     valid JSON, so a failed or empty response never burns quota.
//  2. It must be safe when several users of the same comercio autocomplete at the
//     same time: nobody may slip past the limit because two requests checked the
//     counter before either of them wrote to it.
//
// Both are solved with reserve/commit instead of check-then-increment. A request
// takes a slot BEFORE calling the provider (so concurrent requests cannot
// overshoot), and afterwards commits the slot if the answer was valid or releases
// it if it was not. The result is that the counter converges to "valid answers"
// while the limit is enforced on "calls in flight".
import {
  AutocompleteQuotaRow,
  addAutocompleteAuditLog,
  ensureAutocompleteQuota,
  findAIProviderIdByName,
  getAutocompleteQuota,
  setAutocompleteQuotaCalls,
  updateAutocompleteQuota
} from '../auth/database';
import { cycleStartForDayOfMonth } from '../image-providers/services/engine';
import { logger } from '../../utils/logger';

// No limit at all.
export const QUOTA_UNLIMITED = -1;
// The default: the comercio cannot autocomplete until the super admin enables it.
export const QUOTA_DISABLED = 0;
// Highest billing cycle day we accept; keeps every month long enough for a cycle
// that starts on it (February is the shortest month).
export const MAX_BILLING_CYCLE_DAY = 28;

// Whether a comercio may keep calling the AI provider right now.
export interface QuotaDecision {
  allowed: boolean;
  // Why the request was rejected, for the error message shown to the user.
  reason?: 'disabled' | 'exhausted';
  limit: number;
  used: number;
  remaining: number | null;
  // The period the slot was taken in. Only present when allowed, and needed to
  // refund that slot if the call does not end up counting.
  cycleStart?: string;
}

// Reads the quota row for a comercio, creating it with the defaults if needed,
// and rolls the period over when the cycle day has passed since the stored
// cycle_start. Returns the row with a `calls_this_cycle` that belongs to the
// current period.
function currentQuota(comercioId: number, now: Date): AutocompleteQuotaRow {
  const row = ensureAutocompleteQuota(comercioId);
  const expectedStart = cycleStartForDayOfMonth(row.billing_cycle_day || 1, now);
  if (!row.cycle_start || row.cycle_start < expectedStart) {
    // The period changed since the last call: start a fresh one.
    setAutocompleteQuotaCalls(comercioId, 0, expectedStart);
    return { ...row, calls_this_cycle: 0, cycle_start: expectedStart };
  }
  return row;
}

// Takes one slot from the quota before an AI call, or explains why the request
// must be rejected.
//
// Atomicity: this function is fully synchronous (both DB drivers block, and Node
// runs one task at a time), so the read of `calls_this_cycle` and the write of
// the incremented value cannot be interleaved by another request between the
// check and the update. Concurrent users of the same comercio therefore consume
// distinct slots instead of all reading the same "used" value.
export function reserveAutocompleteCall(comercioId: number, now: Date = new Date()): QuotaDecision {
  const row = currentQuota(comercioId, now);
  const limit = row.monthly_limit;

  if (limit === QUOTA_DISABLED) {
    return { allowed: false, reason: 'disabled', limit, used: row.calls_this_cycle, remaining: 0 };
  }
  if (limit !== QUOTA_UNLIMITED && row.calls_this_cycle >= limit) {
    return { allowed: false, reason: 'exhausted', limit, used: row.calls_this_cycle, remaining: 0 };
  }

  if (limit !== QUOTA_UNLIMITED) {
    setAutocompleteQuotaCalls(comercioId, row.calls_this_cycle + 1, row.cycle_start);
  }
  const used = row.calls_this_cycle;
  return {
    allowed: true,
    limit,
    used: used + 1,
    remaining: limit === QUOTA_UNLIMITED ? null : Math.max(0, limit - used - 1),
    cycleStart: row.cycle_start ?? undefined
  };
}

// Gives a reserved slot back after a call that must not count (provider error,
// invalid JSON, request aborted). Does nothing when the comercio is unlimited,
// since unlimited requests never took a slot.
export function releaseAutocompleteCall(comercioId: number, cycleStart: string): void {
  const row = getAutocompleteQuota(comercioId);
  if (!row) return;
  if (row.monthly_limit === QUOTA_UNLIMITED) return;
  // Only refund the slot while it still belongs to the period it was reserved
  // in; if the period rolled over in the meantime the counter already restarted
  // and there is nothing to refund.
  if (row.cycle_start !== cycleStart) return;
  setAutocompleteQuotaCalls(comercioId, Math.max(0, row.calls_this_cycle - 1), row.cycle_start);
}

// Records the audit entry of a completed call. Only reached with a valid AI
// answer, so the log has exactly one row per consumed slot.
export function recordAutocompleteAudit(entry: {
  comercioId: number;
  userId: number;
  providerName: string;
  status: string;
  brand?: string | null;
  reference?: string | null;
  ean?: string | null;
}): void {
  addAutocompleteAuditLog({
    comercio_id: entry.comercioId,
    user_id: entry.userId,
    ai_provider_id: findAIProviderIdByName(entry.providerName),
    ai_provider_name: entry.providerName,
    status: entry.status,
    product_brand: entry.brand ?? null,
    product_reference: entry.reference ?? null,
    product_ean: entry.ean ?? null
  });
  logger.info('Autocomplete audit recorded', {
    comercioId: entry.comercioId,
    userId: entry.userId,
    provider: entry.providerName,
    status: entry.status,
    reference: entry.reference ?? undefined
  });
}

// Normalises the limit coming from the super admin form. Only the three
// meaningful values are accepted: -1 (unlimited), 0 (disabled) and a positive
// number of calls. Anything else returns null so the request is rejected with a
// 400 instead of guessing: silently turning a typo such as -9 into "unlimited"
// would hand out free quota the super admin never meant to grant.
export function normaliseMonthlyLimit(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return null;
  if (parsed === QUOTA_UNLIMITED || parsed === QUOTA_DISABLED) return parsed;
  return parsed > QUOTA_DISABLED ? parsed : null;
}

// Validates the billing cycle day. Rejects values outside 1..28 instead of
// clamping, so the super admin is told the form value was wrong rather than
// silently getting a different period.
export function normaliseBillingCycleDay(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return 1;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return null;
  if (parsed < 1 || parsed > MAX_BILLING_CYCLE_DAY) return null;
  return parsed;
}

// Applies the super admin settings. Changing the billing cycle day restarts the
// period so the counter never mixes two different cycles.
export function applyAutocompleteQuotaSettings(
  comercioId: number,
  settings: { monthly_limit: number; billing_cycle_day: number },
  now: Date = new Date()
): AutocompleteQuotaRow {
  const previous = ensureAutocompleteQuota(comercioId);
  const cycleDayChanged = previous.billing_cycle_day !== settings.billing_cycle_day;
  updateAutocompleteQuota(comercioId, {
    monthly_limit: settings.monthly_limit,
    billing_cycle_day: settings.billing_cycle_day
  });
  if (cycleDayChanged) {
    setAutocompleteQuotaCalls(comercioId, 0, cycleStartForDayOfMonth(settings.billing_cycle_day, now));
  }
  return getAutocompleteQuota(comercioId)!;
}