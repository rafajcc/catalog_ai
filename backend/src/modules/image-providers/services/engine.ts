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
//
// Persistence (provider rows, round-robin cursor and billing counters) lives
// behind the injected ImageProviderRepository, so this module never imports the
// database. The default is the database-backed repository.

import {
  EngineAttempt,
  ImageProvider,
  ImageProviderDefinition,
  ImageProviderRecord,
  ImageProviderRepository,
  ImageSearchOutcome,
  ImageSearchRequest,
  ProviderError
} from '../types';
import { filterImageUrls } from '../../../utils/image-url-validation';
import { cycleStartForDayOfMonth } from '../../../utils/billing-cycle';
import { getImageProviderDefinition } from '../registry';
import { dbImageProviderRepository } from '../repository';
import { logger } from '../../../utils/logger';

// Budget of real provider calls per product search.
const MAX_PROVIDER_CALLS = 5;

// How many image URLs the search may return at most (matches the slots the
// frontend shows for a product).
export const MAX_AUTOCOMPLETE_IMAGES = 5;

// Records a billing-cycle call for the provider. If its cycle day has passed
// since the stored cycle_start, the counters roll over first. Called AFTER the
// real call so an over-quota provider is skipped BEFORE consuming a call.
function recordCall(
  provider: ImageProviderRecord,
  repository: ImageProviderRepository,
  now: Date = new Date()
): void {
  let cycleStart = provider.cycleStart;
  let calls = provider.callsThisCycle;
  if (provider.billingCycleDay) {
    const expectedStart = cycleStartForDayOfMonth(provider.billingCycleDay, now);
    if (!provider.cycleStart || provider.cycleStart < expectedStart) {
      cycleStart = expectedStart;
      calls = 0;
    }
  }
  repository.recordCall(provider.slug, calls + 1, cycleStart);
}

// Runs the whole pipeline for one product. Throws ProviderError only when there
// is nothing to search at all (no provider enabled/implemented); otherwise it
// returns the outcome, even if empty.
export async function searchProductImages(
  request: ImageSearchRequest,
  repository: ImageProviderRepository = dbImageProviderRepository
): Promise<ImageSearchOutcome> {
  const attempts: EngineAttempt[] = [];
  const rows = repository.list();
  if (rows.length === 0) {
    throw new ProviderError('No hay servicios de imágenes configurados. Configúralos desde el panel de super admin.');
  }

  // 1. Feeds service first (when enabled).
  const feedsDef = getImageProviderDefinition('feeds');
  if (feedsDef) {
    const feedsRow = rows.find((row) => row.slug === 'feeds');
    if (feedsRow && feedsRow.enabled) {
      const outcome = await tryProvider(feedsDef, feedsRow, request, attempts, repository);
      if (outcome) return outcome;
    }
  }

  // 2. Round robin over the rest, starting after the last-called provider.
  const candidates: { definition: ImageProviderDefinition; row: ImageProviderRecord; limit?: number }[] = [];
  for (const row of rows) {
    if (!row.enabled || row.slug === 'feeds') continue;
    const definition = getImageProviderDefinition(row.slug);
    if (!definition || !definition.implemented) continue;
    const limitRaw = parseInt(String(row.config.max_calls_per_month ?? ''), 10);
    candidates.push({ definition, row, limit: Number.isFinite(limitRaw) ? limitRaw : undefined });
  }
  if (candidates.length === 0) {
    throw new ProviderError('No hay servicios de imágenes habilitados e implementados. Actívalos en el panel de super admin.');
  }

  const last = repository.getLastCalled();
  const idx = last ? candidates.findIndex((candidate) => candidate.row.slug === last) : -1;
  const start = idx >= 0 ? idx + 1 : 0;
  const order = Array.from({ length: candidates.length }, (_, i) => (start + i) % candidates.length);

  let realCalls = 0;
  for (const index of order) {
    if (realCalls >= MAX_PROVIDER_CALLS) break;
    const { definition, row, limit } = candidates[index];

    // Billing check first: an over-quota provider is skipped without consuming
    // the real-call budget (its quota status is still logged).
    if (row.callsThisCycle > 0 && limit !== undefined && row.callsThisCycle >= limit) {
      logger.info('Image provider skipped by quota', {
        slug: row.slug,
        reference: request.reference,
        callsThisCycle: row.callsThisCycle,
        limit,
        requestId: request.requestId
      });
      attempts.push({ slug: row.slug, status: 'quota', error: 'Límite mensual alcanzado' });
      continue;
    }

    const outcome = await tryProvider(definition, row, request, attempts, repository);
    realCalls += 1;
    if (outcome) return outcome;
  }

  return { urls: [], source: null, attempts };
}

// Runs one provider and returns the outcome when it yields at least one valid
// image URL. Any failure (create error, ProviderError, network error) is
// recorded as an attempt and treated as "no result", so the engine moves on to
// the next provider. The billing counter/cursor advance for a real call.
async function tryProvider(
  definition: ImageProviderDefinition,
  row: ImageProviderRecord,
  request: ImageSearchRequest,
  attempts: EngineAttempt[],
  repository: ImageProviderRepository
): Promise<ImageSearchOutcome | null> {
  const startedAt = Date.now();
  const maxResults = Math.max(1, Math.min(MAX_AUTOCOMPLETE_IMAGES, request.maxResults));
  const logMeta = {
    slug: row.slug,
    reference: request.reference,
    brand: request.brand,
    ean: request.ean,
    maxResults
  };

  // Same rules as the AI providers: INFO for the call being made and its
  // response received, DEBUG for the request/response bodies.
  logger.info('Image provider request', logMeta);
  logger.debug('Image provider request body', {
    ...logMeta,
    request: { brand: request.brand, reference: request.reference, ean: request.ean, maxResults, origin: request.origin }
  });

  let provider: ImageProvider;
  try {
    provider = definition.create(row.config);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Image provider request error', { ...logMeta, error: message });
    attempts.push({ slug: row.slug, status: 'error', error: message, durationMs: Date.now() - startedAt });
    return null;
  }

  let raw: string[];
  try {
    raw = await provider.search({ ...request, maxResults });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Image provider request error', {
      slug: row.slug,
      reference: request.reference,
      error: message,
      durationMs: Date.now() - startedAt
    });
    attempts.push({
      slug: row.slug,
      status: 'error',
      error: message,
      durationMs: Date.now() - startedAt
    });
    if (row.slug !== 'feeds') repository.setLastCalled(row.slug);
    return null;
  }
  logger.info('Image provider response received', {
    ...logMeta,
    status: 'received',
    urls: (raw ?? []).length,
    durationMs: Date.now() - startedAt
  });

  // Provider URLs come from the services, not from the AI, so invented URLs are
  // much less of a risk; the URLs are still verified so a dead or non-image URL
  // never reaches the frontend. Verified in parallel, bounded by the timeout.
  const urls = (await filterImageUrls(raw ?? [], 5000)).slice(0, maxResults);
  logger.debug('Image provider response body', { ...logMeta, urls });
  const status = urls.length > 0 ? 'ok' : 'empty';
  logger.info('Image provider response', { ...logMeta, status, urls: urls.length, durationMs: Date.now() - startedAt });
  attempts.push({
    slug: row.slug,
    status,
    urls: urls.length,
    durationMs: Date.now() - startedAt
  });
  if (row.slug !== 'feeds') {
    repository.setLastCalled(row.slug);
    recordCall(row, repository);
  }

  if (urls.length === 0) return null;
  return { urls, source: row.slug, attempts };
}
