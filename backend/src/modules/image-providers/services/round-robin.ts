// Centralised round robin for the image provider services.
//
// The engine no longer decides which provider to call: every time it needs a
// provider it asks this scheduler. The scheduler walks the enabled+implemented
// providers in `sort_order`, starting after the one that was handed out last
// (the `last_called` cursor), skips the ones whose monthly allowance is spent
// (rolling the billing cycle over when needed) and reserves the first usable
// provider: it increments its counter and moves the cursor to it BEFORE the
// call is made.
//
// Because the whole selection is synchronous and the database layer is
// synchronous too, two independent searches cannot interleave inside it: each
// one reserves a different slot of the rotation. That is what makes the round
// robin work across concurrent requests. Keeping the selection in a single
// module also means every caller (autocomplete, public API, future flows) shares
// the same rotation.

import { cycleStartForDayOfMonth } from '../../../utils/billing-cycle';
import { getImageProviderDefinition } from '../registry';
import { dbImageProviderRepository } from '../repository';
import {
  EngineAttempt,
  ImageProviderRecord,
  ImageProviderRepository,
  ImageProviderScheduler,
  ImageSearchRequest,
  ProviderSelection,
  ProviderSelectionResult
} from '../types';

// Monthly allowance stored in the provider config. Empty/unparseable means
// unlimited, the same rule the super admin form uses.
function monthlyLimit(row: ImageProviderRecord): number | undefined {
  const raw = parseInt(String(row.config.max_calls_per_month ?? ''), 10);
  return Number.isFinite(raw) ? raw : undefined;
}

// Applies the billing-cycle rollover to the counter snapshot: when the cycle
// day has passed since `cycle_start`, the allowance starts again at zero.
function currentBillingCycle(
  row: ImageProviderRecord,
  now: Date = new Date()
): { calls: number; cycleStart: string | null } {
  if (!row.billingCycleDay) {
    return { calls: row.callsThisCycle, cycleStart: row.cycleStart };
  }
  const expectedStart = cycleStartForDayOfMonth(row.billingCycleDay, now);
  if (!row.cycleStart || row.cycleStart < expectedStart) {
    return { calls: 0, cycleStart: expectedStart };
  }
  return { calls: row.callsThisCycle, cycleStart: row.cycleStart };
}

export class ImageProviderRoundRobin implements ImageProviderScheduler {
  constructor(private readonly repository: ImageProviderRepository) {}

  // The feeds service is not part of the rotation: it is always tried first
  // and never consumes quota nor moves the cursor.
  getFeeds(): ProviderSelection | null {
    const definition = getImageProviderDefinition('feeds');
    if (!definition) return null;
    const row = this.repository.list().find((candidate) => candidate.slug === 'feeds');
    if (!row || !row.enabled) return null;
    return { definition, row };
  }

  nextProvider(): ProviderSelectionResult {
    const rows = this.repository.list();
    if (rows.length === 0) {
      return { selection: null, skippedByQuota: [], reason: 'none_configured' };
    }

    const candidates: ProviderSelection[] = [];
    for (const row of rows) {
      if (!row.enabled || row.slug === 'feeds') continue;
      const definition = getImageProviderDefinition(row.slug);
      if (!definition || !definition.implemented) continue;
      candidates.push({ definition, row });
    }

    if (candidates.length === 0) {
      return { selection: null, skippedByQuota: [], reason: 'none_enabled' };
    }

    const last = this.repository.getLastCalled();
    const lastIndex = last
      ? candidates.findIndex((candidate) => candidate.row.slug === last)
      : -1;
    const start = lastIndex >= 0 ? (lastIndex + 1) % candidates.length : 0;

    const skippedByQuota: string[] = [];
    for (let offset = 0; offset < candidates.length; offset += 1) {
      const candidate = candidates[(start + offset) % candidates.length];
      const limit = monthlyLimit(candidate.row);
      const cycle = currentBillingCycle(candidate.row);
      if (limit !== undefined && cycle.calls >= limit) {
        skippedByQuota.push(candidate.row.slug);
        continue;
      }
      // Reserve before returning: the counter and the cursor move together in a
      // single persistence, so a search asking right after this one already
      // sees the next provider.
      this.repository.reserve(candidate.row.slug, cycle.calls + 1, cycle.cycleStart);
      return { selection: candidate, skippedByQuota, reason: 'ok' };
    }

    return { selection: null, skippedByQuota, reason: 'all_exhausted' };
  }

  recordAttempts(request: ImageSearchRequest, attempts: EngineAttempt[]): void {
    this.repository.recordAttempts(request, attempts);
  }
}

// Default instance bound to the application database. The engine takes the port
// as a parameter so tests can inject an isolated repository.
export const defaultImageProviderScheduler = new ImageProviderRoundRobin(
  dbImageProviderRepository
);
