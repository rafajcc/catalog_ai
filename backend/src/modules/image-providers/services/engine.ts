// Image search engine: coordinates the provider services for the autocomplete
// endpoint. Every search is bounded (5 real provider calls max), capped in
// width (maxResults) and validated with the shared image URL filter, so the
// frontend only ever receives clean image URLs.
//
// Behaviour:
//   1. Feeds first: when the feeds service is enabled it is tried before the
//      providers, because it is the cheapest and most reliable source. It never
//      advances the round-robin cursor nor the billing counters.
//   2. Round robin over the enabled+implemented providers: before EVERY real
//      call the engine asks the scheduler "who do I call?". The scheduler owns
//      the cursor and the monthly quota, and reserves the call (counter + cursor)
//      before returning the provider, so concurrent searches never receive the
//      same slot of the rotation.
//   3. Billing cycles: a provider with an exhausted monthly allowance is skipped
//      by the scheduler WITHOUT consuming the 5-call budget or asking the
//      provider; every real call was already counted when it was handed out.
//   4. Accumulation: a product must end up with maxResults images. Each
//      provider is only asked for the slots still missing (maxResults minus the
//      URLs already gathered in this search), so a provider that returns fewer
//      than asked leaves the remaining slots to the NEXT call. The search stops
//      as soon as maxResults images are gathered or the 5-call budget is spent.
//      The outcome reports every provider that contributed an image, joined in
//      call order.
//   5. Every provider that was visited (called or skipped by quota) is logged
//      in the attempts array for traceability and the super admin panel.
//
// Persistence (provider rows, round-robin cursor and billing counters) and the
// provider selection live behind the injected ImageProviderScheduler, so this
// module never imports the database. The default is the centralized round robin
// backed by the application database.

import {
  EngineAttempt,
  ImageProvider,
  ImageProviderScheduler,
  ImageSearchOutcome,
  ImageSearchRequest,
  NoImagesError,
  ProviderError,
  ProviderSelection,
  ProviderSelectionReason
} from '../types';
import { filterImageUrls } from '../../../utils/image-url-validation';
import { remainingMs, withTimeout } from '../../../utils/timeout';
import { defaultImageProviderScheduler } from './round-robin';
import { logger } from '../../../utils/logger';

// Budget of real provider calls per product search.
const MAX_PROVIDER_CALLS = 5;

// How many image URLs the search may return at most (matches the slots the
// frontend shows for a product).
export const MAX_AUTOCOMPLETE_IMAGES = 5;

// Records the audit trail of the search. The scheduler owns it so the engine is
// not tied to the database.
function persistAttempts(
  scheduler: ImageProviderScheduler,
  request: ImageSearchRequest,
  attempts: EngineAttempt[]
): void {
  if (attempts.length === 0) return;
  try {
    scheduler.recordAttempts(request, attempts);
  } catch (error) {
    logger.error('No se pudo guardar la auditoría de proveedores de imágenes', {
      requestId: request.requestId,
      reference: request.reference,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

// Runs the whole pipeline for one product. Throws ProviderError only when there
// is nothing to search at all (no provider configured/enabled/implemented);
// otherwise it returns the outcome, even if empty.
export async function searchProductImages(
  request: ImageSearchRequest,
  scheduler: ImageProviderScheduler = defaultImageProviderScheduler
): Promise<ImageSearchOutcome> {
  const attempts: EngineAttempt[] = [];

  // The product must end up with at most this many images, and every provider
  // is asked only for what is still missing.
  const maxResults = Math.max(1, Math.min(MAX_AUTOCOMPLETE_IMAGES, request.maxResults));
  const collected: string[] = [];
  const sources: string[] = [];

  // Adds the URLs a provider produced, skipping any already gathered by an
  // earlier provider so the same image is never counted twice (five distinct
  // images must fill the five slots).
  const addFound = (slug: string, found: string[]): void => {
    let added = 0;
    for (const url of found) {
      if (collected.length >= maxResults) break;
      if (collected.includes(url)) continue;
      collected.push(url);
      added += 1;
    }
    if (added > 0) sources.push(slug);
  };

  // 1. Feeds service first (when enabled). It can already fill part (or all) of
  // the slots; whatever it fills is subtracted from what the providers below
  // are asked for.
  const feeds = scheduler.getFeeds();
  if (feeds && collected.length < maxResults) {
    const found = await tryProvider(feeds, request, maxResults - collected.length, attempts);
    addFound(feeds.row.slug, found);
  }

  // 2. Ask the scheduler for a provider before EVERY real call. It reserves the
  // call (quota + cursor) before answering, so two searches running in parallel
  // get different providers instead of racing over the same cursor.
  let realCalls = 0;
  let exhaustedReason: ProviderSelectionReason | null = null;

  while (collected.length < maxResults && realCalls < MAX_PROVIDER_CALLS) {
    // Budget of the exchange: when it is spent the search stops here and
    // returns the images already gathered. Without this the search could take
    // minutes (some providers answer in up to 300s) and the caller would time
    // out waiting for a response it already had the text of. Checked BEFORE
    // asking the scheduler so an expired search never reserves a call.
    const remaining = remainingMs(request.deadline);
    if (remaining !== undefined && remaining <= 0) {
      logger.info('Image search budget spent, stopping with the images already found', {
        reference: request.reference,
        requestId: request.requestId
      });
      break;
    }

    const answer = scheduler.nextProvider();

    // A provider over its monthly allowance is logged but does not consume the
    // real-call budget: the scheduler already skipped it.
    for (const slug of answer.skippedByQuota) {
      logger.info('Image provider skipped by quota', {
        slug,
        reference: request.reference,
        requestId: request.requestId
      });
      attempts.push({
        slug,
        status: 'quota',
        requested: maxResults - collected.length,
        error: 'Límite mensual alcanzado'
      });
    }

    if (!answer.selection) {
      exhaustedReason = answer.reason;
      break;
    }

    const selection = answer.selection;

    // Only the slots still missing are requested, so a provider that returns
    // fewer than asked leaves the rest to the next one. The call is cut at the
    // remaining budget: a provider that hangs (its own HTTP timeout goes up
    // to 300s) must not hold the whole exchange back.
    const call = tryProvider(selection, request, maxResults - collected.length, attempts);
    const budget = remainingMs(request.deadline);
    let found: string[];
    if (budget === undefined) {
      found = await call;
    } else {
      try {
        found = await withTimeout(call, budget, `Image provider ${selection.row.slug}`);
      } catch (error) {
        logger.warn(`El proveedor de imágenes ${selection.row.slug} agotó el presupuesto de la búsqueda`, {
          reference: request.reference,
          requestId: request.requestId,
          error: error instanceof Error ? error.message : String(error)
        });
        attempts.push({
          slug: selection.row.slug,
          status: 'error',
          requested: maxResults - collected.length,
          error: `Se agotó el presupuesto de ${budget}ms de la búsqueda de imágenes`
        });
        break;
      }
    }
    realCalls += 1;
    addFound(selection.row.slug, found);
  }

  // Nothing to search at all is a configuration error, not an empty result. It
  // only surfaces when neither the feeds nor any provider produced anything.
  if (collected.length === 0 && realCalls === 0 && exhaustedReason) {
    persistAttempts(scheduler, request, attempts);
    if (exhaustedReason === 'none_configured') {
      throw new ProviderError('No hay servicios de imágenes configurados. Configúralos desde el panel de super admin.');
    }
    if (exhaustedReason === 'none_enabled') {
      throw new ProviderError('No hay servicios de imágenes habilitados e implementados. Actívalos en el panel de super admin.');
    }
  }

  persistAttempts(scheduler, request, attempts);

  return { urls: collected, source: sources.length > 0 ? sources.join('+') : null, attempts };
}

// Runs one provider and returns the valid image URLs it produced (ordered),
// asking it for at most `maxResults` URLs. Any failure (create error,
// ProviderError, network error) is recorded as an attempt and treated as "no
// result", so the engine moves on to the next provider. The quota and cursor
// were already updated by the scheduler when it handed the provider out.
async function tryProvider(
  selection: ProviderSelection,
  request: ImageSearchRequest,
  maxResults: number,
  attempts: EngineAttempt[]
): Promise<string[]> {
  const { definition, row } = selection;
  const startedAt = Date.now();
  const wanted = Math.max(1, Math.min(MAX_AUTOCOMPLETE_IMAGES, maxResults));
  const logMeta = {
    slug: row.slug,
    reference: request.reference,
    brand: request.brand,
    ean: request.ean,
    maxResults: wanted
  };

  // Same rules as the AI providers: INFO for the call being made and its
  // response received, DEBUG for the request/response bodies.
  logger.info('Image provider request', logMeta);
  logger.debug('Image provider request body', {
    ...logMeta,
    request: { brand: request.brand, reference: request.reference, ean: request.ean, maxResults: wanted, origin: request.origin }
  });

  let provider: ImageProvider;
  try {
    provider = definition.create(row.config);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Image provider request error', { ...logMeta, error: message });
    attempts.push({ slug: row.slug, status: 'error', requested: wanted, error: message, durationMs: Date.now() - startedAt });
    return [];
  }

  let raw: string[];
  try {
    raw = await provider.search({ ...request, maxResults: wanted });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // "The provider answered and had no images" is a successful empty result,
    // not a failure: it must reach the audit as "Sin imágenes" (status empty).
    if (error instanceof NoImagesError) {
      logger.info('Image provider without results', {
        ...logMeta,
        error: message,
        durationMs: Date.now() - startedAt
      });
      attempts.push({
        slug: row.slug,
        status: 'empty',
        requested: wanted,
        urls: 0,
        durationMs: Date.now() - startedAt
      });
      return [];
    }
    logger.error('Image provider request error', {
      slug: row.slug,
      reference: request.reference,
      error: message,
      durationMs: Date.now() - startedAt
    });
    attempts.push({
      slug: row.slug,
      status: 'error',
      requested: wanted,
      error: message,
      durationMs: Date.now() - startedAt
    });
    return [];
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
  const validated = await filterImageUrls(raw ?? [], 5000);
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const url of validated) {
    if (seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
    if (urls.length >= wanted) break;
  }
  logger.debug('Image provider response body', { ...logMeta, urls });
  const status = urls.length > 0 ? 'ok' : 'empty';
  logger.info('Image provider response', { ...logMeta, status, urls: urls.length, durationMs: Date.now() - startedAt });
  attempts.push({
    slug: row.slug,
    status,
    requested: wanted,
    urls: urls.length,
    durationMs: Date.now() - startedAt
  });

  return urls;
}
