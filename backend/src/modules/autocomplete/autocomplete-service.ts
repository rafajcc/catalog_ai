// Reusable autocomplete orchestration.
//
// This is the single source of truth for one autocomplete exchange: resolve the
// global AI provider, ask it only about the still-empty text fields, search the
// remaining product images in parallel, take/refund the per-comercio quota slot
// and settle the audit entry. Both the internal web route (POST /api/autocomplete)
// and the public API (POST /api/public/autocomplete) call this service, so the
// quota, the audit log and the response shape can never drift apart between the
// two callers.
//
// The service is transport-agnostic: it takes plain values (comercioId, userId,
// origin, requestId) instead of an Express request, and returns a plain result
// instead of writing to a response.

import { AITextSuggester, generateRequestId } from '../ai-text-suggester/ai-text-suggester';
import { DEFAULT_AI_PROMPTS } from '../ai-text-suggester/default-prompts';
import {
  AUTOCOMPLETE_FIELDS,
  buildCompletionResponseInstructions,
  extractCompletionProposals,
  fillPrompt,
  isValidCompletionStatus,
  parseCompletionResponse
} from '../ai-text-suggester/autocomplete';
import { resolveActiveProviderOrThrow, translateAIError } from '../ai-config/global-ai';
import { DEFAULT_AI_TIMEOUT_S } from '../ai-providers/utils';
import { MAX_AUTOCOMPLETE_IMAGES } from '../image-providers/services/engine';
import { ImageSearcher } from '../image-providers/types';
import {
  recordAutocompleteAudit,
  releaseAutocompleteCall,
  reserveAutocompleteCall
} from '../autocomplete-quota/quota';
import { AIConfig, ProductData } from '../../types';
import { AppError } from '../../utils/error-handler';
import { logger } from '../../utils/logger';
import { getLogContext } from '../../utils/log-context';
import { withTimeout } from '../../utils/timeout';

// Grace added to the budget of the image search before giving it up for good.
// The engine stops on its own when the budget is spent (returning the images
// it already gathered); this margin is only the safety net for a provider that
// hangs inside a single call.
const IMAGE_SEARCH_GRACE_MS = 2000;

// Lightweight input check shared by BOTH callers (the web route and the public
// API), so the contract they enforce is identical and cannot drift. It only
// rejects what the service cannot work with; it does not reshape or coerce the
// product (the AI fields are already read defensively further down). Throws
// AppError(400) so the shared error handler answers with the usual
// {success:false,error:{...}} body.
export function validateAutocompleteInput(input: { product?: unknown; language?: unknown }): {
  product: ProductData;
  language?: unknown;
} {
  const product = input?.product;
  if (!product || typeof product !== 'object' || Array.isArray(product)) {
    throw new AppError('A product is required to autocomplete its fields', 400, undefined, 'invalid_product');
  }

  const candidate = product as Record<string, unknown>;
  const reference = candidate.reference;
  const id = candidate.id;
  const hasReference = typeof reference === 'string' && reference.trim() !== '';
  const hasId = typeof id === 'string' && id.trim() !== '';
  if (!hasReference && !hasId) {
    throw new AppError(
      'The product must have a reference or an id to autocomplete its fields',
      400,
      undefined,
      'invalid_product'
    );
  }

  if (input.language !== undefined && typeof input.language !== 'string') {
    throw new AppError('language must be a string when provided', 400, undefined, 'invalid_language');
  }

  return { product: product as ProductData, language: input.language };
}

export interface RunAutocompleteInput {
  product: ProductData;
  // Requested UI language; falls back to the AI config language (default 'es').
  language?: unknown;
  // Global AI config of the store. Optional: when omitted the service reads the
  // default (undefined), which resolveActiveProviderOrThrow rejects with a clear
  // 503 — the callers pass the store config they already loaded.
  ai: AIConfig | undefined;
  // Image search port, injected by the caller so the service never imports the
  // concrete engine or the database.
  searchImages: ImageSearcher;
  // Tenant charged for the AI call. 0/undefined means "no comercio" (the super
  // admin, which never takes a quota slot).
  comercioId?: number;
  // Caller user id, kept for the traceability logs and the audit entry.
  userId?: number;
  // Public origin (scheme://host), forwarded to the image search.
  origin: string;
  // Comercio name for the image-search logs (the username on the web route).
  comercioName?: string;
  // Correlation id of the request; a new one is generated when absent.
  requestId?: string;
  // Budget of the image search, in ms. Defaults to the provider timeout (the
  // same budget the AI call gets). Only the tests override it.
  imageTimeoutMs?: number;
}

export interface AutocompleteResult {
  reference: string;
  status: string;
  confidence: number | null;
  warnings: string[];
  proposals: Partial<Record<string, string>>;
  ai_error: string | null;
  image_urls: string[];
  image_source: string | null;
}

/**
 * Runs one autocomplete exchange and returns the same shape the web route has
 * always returned. Throws AppError (401/429/503) the same way the route did, so
 * both callers can surface identical errors.
 */
export async function runAutocomplete(input: RunAutocompleteInput): Promise<AutocompleteResult> {
  // The service re-validates even though the callers also validate, so a caller
  // that forgets to (or a future one) can never push a malformed product into the
  // AI/image pipeline. Same check, same 400 contract on both surfaces.
  validateAutocompleteInput({ product: input.product, language: input.language });
  const { product, ai, searchImages } = input;

  // AI is global and configured by the super admin. Fail fast (before any quota
  // is reserved or a provider is called) when nothing usable is configured, with
  // a message that points the comercio to the admin.
  const effectiveAI = resolveActiveProviderOrThrow(ai);

  const language =
    input.language === 'es' || input.language === 'en'
      ? input.language
      : effectiveAI.language === 'en'
        ? 'en'
        : 'es';
  const promptSource = effectiveAI.default_prompt?.trim() || DEFAULT_AI_PROMPTS[language] || DEFAULT_AI_PROMPTS.en;

  const suggester = new AITextSuggester(effectiveAI);

  const origin = input.origin;
  // One correlation id for the whole exchange (AI call plus image search), so
  // the logs of both stay linked together. Reuse the request one when present.
  const requestId = input.requestId || getLogContext().requestId || generateRequestId();
  const reference = product.reference ?? '';
  const brand = product.brand ?? '';
  const ean = product.ean ?? '';

  // The AI is only asked about the autocomplete fields that are still empty (the
  // product may have come with some of them already filled), so it never
  // proposes values for text that is already there.
  const missingFields = AUTOCOMPLETE_FIELDS.filter((field) => {
    const value = product[field as keyof ProductData];
    return typeof value !== 'string' || value.trim() === '';
  });

  // Per-comercio quota, checked BEFORE any provider is called so a request over
  // the limit costs nothing: no AI call, no image search. The check takes the
  // slot atomically, which is what keeps several callers of the same comercio
  // from overshooting the limit at the same time.
  //
  // Nothing is reserved when the AI is not going to be asked (the product already
  // has every field), because no provider call happens and a slot taken for a
  // call that never occurs would be a call the comercio never made. The super
  // admin has no comercio (id 0) and does not pay quota.
  const userComercioId = input.comercioId;
  const quotaComercioId =
    typeof userComercioId === 'number' && userComercioId > 0 && missingFields.length > 0 ? userComercioId : null;
  let reservation: { comercioId: number; cycleStart: string } | null = null;
  if (quotaComercioId !== null) {
    const decision = reserveAutocompleteCall(quotaComercioId);
    if (!decision.allowed) {
      logger.info('Autocomplete blocked by quota', {
        requestId,
        comercioId: quotaComercioId,
        reason: decision.reason,
        used: decision.used,
        limit: decision.limit,
        reference
      });
      throw new AppError(
        decision.reason === 'disabled'
          ? 'AI autocomplete is not enabled for your account. Contact the administrator.'
          : 'AI autocomplete limit reached for the current billing period.',
        429,
        {
          reason: decision.reason,
          limit: decision.limit,
          used: decision.used,
          remaining: decision.remaining
        },
        'autocomplete_quota_exceeded'
      );
    }
    // Remembered so the slot can be refunded if the AI ends up not answering
    // with a valid JSON (see the release call below).
    reservation = { comercioId: quotaComercioId, cycleStart: decision.cycleStart ?? '' };
  }

  // The brand/reference/EAN image search only runs when the product still has
  // image slots free; a fully illustrated product skips the call.
  const existingImageCount = Array.isArray(product.images) ? product.images.length : 0;
  const freeImageSlots = Math.max(0, MAX_AUTOCOMPLETE_IMAGES - existingImageCount);
  const willSearchImages = freeImageSlots > 0;

  // ONE budget for the whole exchange, taken from the provider timeout the
  // super admin configured (30s by default). The AI call and the image search
  // run in parallel and share it, so:
  //  - the answer always arrives before the timeout the browser waits for
  //    (provider timeout + grace), instead of timing out with nothing,
  //  - a slow image provider can never throw away the AI proposals that are
  //    already ready: the search stops when the budget is spent and returns
  //    the images it managed to gather.
  // The image budget can be overridden by the caller (used by the tests).
  const exchangeBudgetMs = (effectiveAI.timeout ?? DEFAULT_AI_TIMEOUT_S) * 1000;
  const imageBudgetMs = input.imageTimeoutMs ?? exchangeBudgetMs;
  const imageDeadline = Date.now() + imageBudgetMs;

  // AI and image search are independent, so both run in parallel and the product
  // only waits for the slowest of the two. When a call is skipped (nothing to
  // fill / no slot left) the reason is logged so the decision is always
  // traceable. Each branch also isolates its OWN failures: an error or timeout
  // in the AI call never cancels the image search, and vice versa. Both branches
  // are bound by the exchange budget, so the answer always arrives in time and a
  // slow provider can never make the request time out with nothing.
  const [aiOutcome, imageOutcome] = await Promise.all([
    (async () => {
      if (missingFields.length === 0) {
        logger.info('AI autocomplete skipped', {
          requestId,
          reference,
          reason: 'El producto ya tiene los 4 campos de texto (description, description_short, meta_title, meta_description)'
        });
        return { status: 'ok', confidence: null, warnings: [], proposals: {}, ai_error: null };
      }
      try {
        logger.info('AI autocomplete request', { requestId, reference, provider: effectiveAI.provider, fields: missingFields });
        const message = `${fillPrompt(promptSource, product)}\n\n${buildCompletionResponseInstructions(language, missingFields)}`;

        let raw: string;
        try {
          raw = await suggester.complete({ prompt: message, product, fields: missingFields, requestId });
        } catch (error) {
          // The AI call failed: do not fail the whole request. The image search
          // still runs and its results are returned, so the product can get
          // images even without the AI-generated descriptions.
          logger.warn(`AI autocomplete falló para ${reference}: ${translateAIError(error, effectiveAI.provider)}`, { requestId });
          return { status: 'error', confidence: null, warnings: [], proposals: {}, ai_error: translateAIError(error, effectiveAI.provider) };
        }

        let parsed: any;
        try {
          parsed = parseCompletionResponse(raw);
        } catch {
          logger.warn(`AI autocomplete devolvió JSON inválido para ${reference}`, { requestId });
          return {
            status: 'error',
            confidence: null,
            warnings: [],
            proposals: {},
            ai_error: 'The AI response was not valid JSON matching the expected structure'
          };
        }

        return {
          status: typeof parsed.status === 'string' ? parsed.status : 'unknown',
          confidence: typeof parsed.confidence === 'number' ? parsed.confidence : null,
          warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
          proposals: extractCompletionProposals(parsed, missingFields),
          ai_error: null
        };
      } catch (error) {
        // Last-resort guard: everything above (prompt building included) lives
        // inside this try, so an unexpected failure preparing the AI exchange can
        // never reject this branch and cancel the image search.
        logger.error(`AI autocomplete error inesperado para ${reference}`, { requestId, error: error instanceof Error ? error.message : String(error) });
        return { status: 'error', confidence: null, warnings: [], proposals: {}, ai_error: error instanceof Error ? error.message : String(error) };
      }
    })(),
    (async (): Promise<{ urls: string[]; source: string | null }> => {
      try {
        if (!willSearchImages) {
          logger.info('Image search skipped', {
            requestId,
            reference,
            reason: `El producto ya tiene ${existingImageCount} imágenes (máximo ${MAX_AUTOCOMPLETE_IMAGES})`
          });
          return { urls: [], source: null };
        }
        // Product images come from the image provider services configured by the
        // super admin (feeds first, then round-robin providers). The AI is never
        // asked for image URLs, so no invented URL can reach the caller. Only the
        // remaining free slots are requested.
        const outcome = await withTimeout(
          searchImages({
            brand,
            reference,
            ean,
            origin,
            maxResults: freeImageSlots,
            comercioId: input.comercioId,
            comercioName: input.comercioName,
            requestId,
            deadline: imageDeadline
          }),
          imageBudgetMs + IMAGE_SEARCH_GRACE_MS,
          'Image search'
        );
        if (outcome.attempts.length > 0) {
          logger.debug(`Búsqueda de imágenes para ${reference}`, { requestId, attempts: outcome.attempts });
        }
        return { urls: outcome.urls, source: outcome.source };
      } catch (error) {
        // The image search failed (a provider timed out, none is enabled, ...):
        // it must never cancel the AI proposals, so the product keeps the
        // AI-generated text and simply ends with no new images.
        logger.warn(`No se pudieron obtener imágenes para ${reference}: ${error instanceof Error ? error.message : String(error)}`, {
          requestId
        });
        return { urls: [], source: null };
      }
    })()
  ]);

  // Settles the quota slot taken above now that the AI call has finished:
  //
  //  - valid JSON with a status of the contract -> the slot is consumed and an
  //    audit row is written, so the counter only ever counts answers the comercio
  //    can prove it got.
  //  - anything else (provider error, unparseable JSON, a status outside the
  //    contract) -> the slot is refunded, because no usable answer was produced.
  //
  // The image search does not affect the counter: the limit is on AI calls.
  if (reservation) {
    if (isValidCompletionStatus(aiOutcome.status)) {
      recordAutocompleteAudit({
        comercioId: reservation.comercioId,
        userId: input.userId ?? 0,
        providerName: effectiveAI.provider,
        status: aiOutcome.status,
        brand,
        reference,
        ean
      });
    } else {
      if (aiOutcome.status !== 'error') {
        logger.info('AI autocomplete devolvió un status fuera del contrato, no se consume cuota', {
          requestId,
          comercioId: reservation.comercioId,
          reference,
          status: String(aiOutcome.status)
        });
      }
      if (reservation.cycleStart) {
        releaseAutocompleteCall(reservation.comercioId, reservation.cycleStart);
      }
    }
  }

  return {
    reference,
    status: aiOutcome.status,
    confidence: aiOutcome.confidence,
    warnings: aiOutcome.warnings,
    proposals: aiOutcome.proposals,
    ai_error: aiOutcome.ai_error ?? null,
    image_urls: imageOutcome.urls,
    image_source: imageOutcome.source
  };
}
