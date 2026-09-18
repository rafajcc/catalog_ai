// Image search engine: coordinates the provider services for the autocomplete
// endpoint. Every search is bounded (5 real provider calls max), capped in
// width (maxResults) and validated with the shared image URL filter, so the
// frontend only ever receives clean image URLs.
//
// Behaviour:
//   1. Feeds first: when the feeds service is enabled it is tried before the
//      providers, because it is the cheapest and most reliable source. It never
//      advances the round-robin cursor nor the billing counters.
//   2. Round robin over the enabled+implemented providers (sort_order), always
//      starting after the provider that made the last real call (the global
//      last_called marker).
//   3. Billing cycles: a provider without API key or with an exhausted monthly
//      allowance is skipped WITHOUT consuming the 5-call budget; every real
//      call records the billing-cycle counters and advances the cursor.
//   4. The first provider that returns >= 1 valid image wins; its URLs become
//      the outcome.
//   5. Every provider that was visited (called or skipped by quota) is logged
//      in the attempts array for traceability and the super admin panel.

import {
  EngineAttempt,
  ImageProvider,
  ImageProviderDefinition,
  ImageSearchOutcome,
  ImageSearchRequest,
  ProviderError
} from '../types';
import {
  getLastCalledImageProvider,
  ImageProviderRow,
  listImageProviders,
  setLastCalledImageProvider,
  updateImageProvider
} from '../../auth/database';
import { filterImageUrls } from '../../ai-text-suggester/image-url-validation';
import { getImageProviderDefinition } from '../registry';

// Budget of real provider calls per product search.
const MAX_PROVIDER_CALLS = 5;

// How many image URLs the search may return at most (matches the slots the
// frontend shows for a product).
export const MAX_AUTOCOMPLETE_IMAGES = 5;

// ISO start of the billing cycle for a provider whose cycle day falls on
// `billingDay` of each month (clamped to the last day of shorter months).
function cycleDay(date: Date, day: number): number {
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  return Math.min(day, lastDay);
}

// Start date (YYYY-MM-DD) of the current billing cycle for a provider with the
// given billing day of month. Exported for the super admin reset endpoint.
export function cycleStartForDayOfMonth(billingDay: number, now: Date = new Date()): string {
  const year = now.getFullYear();
  const monthIndex = now.getMonth();
  const day = cycleDay(now, billingDay);
  const currentStart = new Date(year, monthIndex, day);
  if (now.getTime() >= currentStart.getTime()) {
    return currentStart.toISOString().slice(0, 10);
  }
  const previous = new Date(year, monthIndex - 1, day);
  return previous.toISOString().slice(0, 10);
}

function parseConfig(row: ImageProviderRow): Record<string, string> {
  try {
    const parsed = JSON.parse(row.config);
    if (parsed && typeof parsed === 'object') {
      const out: Record<string, string> = {};
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
          out[key] = String(value);
        }
      }
      return out;
    }
  } catch {
    // fall through
  }
  return {};
}

// Records a billing-cycle call for the provider. If its cycle day has passed
// since the stored cycle_start, the counters roll over first. Called AFTER the
// real call so an over-quota provider is skipped BEFORE consuming a call.
function recordCall(provider: ImageProviderRow): void {
  const now = new Date();
  let cycleStart = provider.cycle_start;
  let calls = provider.calls_this_cycle;
  if (provider.billing_cycle_day) {
    const expectedStart = cycleStartForDayOfMonth(provider.billing_cycle_day, now);
    if (!provider.cycle_start || provider.cycle_start < expectedStart) {
      cycleStart = expectedStart;
      calls = 0;
    }
  }
  updateImageProvider(provider.slug, { calls_this_cycle: calls + 1, cycle_start: cycleStart });
}

// Runs the whole pipeline for one product. Throws ProviderError only when there
// is nothing to search at all (no provider enabled/implemented); otherwise it
// returns the outcome, even if empty.
export async function searchProductImages(request: ImageSearchRequest): Promise<ImageSearchOutcome> {
  const attempts: EngineAttempt[] = [];
  const rows = listImageProviders();
  if (rows.length === 0) {
    throw new ProviderError('No hay servicios de imágenes configurados. Configúralos desde el panel de super admin.');
  }

  // 1. Feeds service first (when enabled).
  const feedsDef = getImageProviderDefinition('feeds');
  if (feedsDef) {
    const feedsRow = rows.find((row) => row.slug === 'feeds');
    if (feedsRow && feedsRow.enabled) {
      const outcome = await tryProvider(feedsDef, feedsRow, request, attempts);
      if (outcome) return outcome;
    }
  }

  // 2. Round robin over the rest, starting after the last-called provider.
  const candidates: { definition: ImageProviderDefinition; row: ImageProviderRow; limit?: number }[] = [];
  for (const row of rows) {
    if (!row.enabled || row.slug === 'feeds') continue;
    const definition = getImageProviderDefinition(row.slug);
    if (!definition || !definition.implemented) continue;
    const config = parseConfig(row);
    const limitRaw = parseInt(String(config.max_calls_per_month ?? ''), 10);
    candidates.push({ definition, row, limit: Number.isFinite(limitRaw) ? limitRaw : undefined });
  }
  if (candidates.length === 0) {
    throw new ProviderError('No hay servicios de imágenes habilitados e implementados. Actívalos en el panel de super admin.');
  }

  const last = getLastCalledImageProvider();
  const idx = last ? candidates.findIndex((candidate) => candidate.row.slug === last) : -1;
  const start = idx >= 0 ? idx + 1 : 0;
  const order = Array.from({ length: candidates.length }, (_, i) => (start + i) % candidates.length);

  let realCalls = 0;
  for (const index of order) {
    if (realCalls >= MAX_PROVIDER_CALLS) break;
    const { definition, row, limit } = candidates[index];

    // Billing check first: an over-quota provider is skipped without consuming
    // the real-call budget (its quota status is still logged).
    if (row.calls_this_cycle > 0 && limit !== undefined && row.calls_this_cycle >= limit) {
      attempts.push({ slug: row.slug, status: 'quota', error: 'Límite mensual alcanzado' });
      continue;
    }

    const outcome = await tryProvider(definition, row, request, attempts);
    if (outcome) return outcome;
    realCalls += 1;
  }

  return { urls: [], source: null, attempts };
}

// Tries a single provider: validates the returned URLs, records the billing
// call and advances the round-robin cursor. Returns the outcome when the
// provider returned at least one valid image, null otherwise (the attempt is
// logged either way).
async function tryProvider(
  definition: ImageProviderDefinition,
  row: ImageProviderRow,
  request: ImageSearchRequest,
  attempts: EngineAttempt[]
): Promise<ImageSearchOutcome | null> {
  const startedAt = Date.now();
  const config = parseConfig(row);
  const maxResults = Math.max(1, Math.min(MAX_AUTOCOMPLETE_IMAGES, request.maxResults));

  let provider: ImageProvider;
  try {
    provider = definition.create(config);
  } catch (error) {
    attempts.push({ slug: row.slug, status: 'error', error: error instanceof Error ? error.message : String(error), durationMs: Date.now() - startedAt });
    return null;
  }

  let raw: string[];
  try {
    raw = await provider.search({ ...request, maxResults });
  } catch (error) {
    attempts.push({
      slug: row.slug,
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startedAt
    });
    if (row.slug !== 'feeds') setLastCalledImageProvider(row.slug);
    return null;
  }

  // Provider URLs come from the services, not from the AI, so invented URLs are
  // much less of a risk; the URLs are still verified so a dead or non-image URL
  // never reaches the frontend. Verified in parallel, bounded by the timeout.
  const urls = (await filterImageUrls(raw ?? [], 5000)).slice(0, maxResults);
  attempts.push({
    slug: row.slug,
    status: urls.length > 0 ? 'ok' : 'empty',
    urls: urls.length,
    durationMs: Date.now() - startedAt
  });
  if (row.slug !== 'feeds') {
    setLastCalledImageProvider(row.slug);
    recordCall(row);
  }

  if (urls.length === 0) return null;
  return { urls, source: row.slug, attempts };
}