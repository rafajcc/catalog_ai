// Database-backed implementation of the engine's persistence port. It is the
// ONLY place of the image-search pipeline that touches auth/database: the
// engine takes an ImageProviderRepository, so swapping the storage never
// touches the orchestration code (and tests can inject an in-memory one).

import {
  addImageProviderAuditLogs,
  getLastCalledImageProvider,
  ImageProviderRow,
  listImageProviders,
  setLastCalledImageProvider,
  updateImageProvider
} from '../auth/database';
import { getImageProviderDefinition } from './registry';
import { EngineAttempt, ImageProviderRecord, ImageProviderRepository, ImageSearchRequest } from './types';

// Parses the JSON config column into a flat string map, ignoring anything that
// is not a scalar (the super admin form only ever stores scalars).
function parseStoredConfig(raw: string): Record<string, string> {
  try {
    const parsed = JSON.parse(raw);
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

function toRecord(row: ImageProviderRow): ImageProviderRecord {
  return {
    slug: row.slug,
    enabled: row.enabled === 1,
    config: parseStoredConfig(row.config),
    billingCycleDay: row.billing_cycle_day,
    callsThisCycle: row.calls_this_cycle,
    cycleStart: row.cycle_start
  };
}

// Removes credentials from provider error messages before they are persisted:
// some SDKs echo the request URL (and its token) or a bearer header.
function sanitizeAuditError(message: string | undefined): string | null {
  if (!message) return null;
  const clean = message
    .replace(/([?&](?:token|api[_-]?key|key|password|secret)=)[^&\s]+/gi, '$1***')
    .replace(/\/\/[^/@\s]+@/g, '//***@')
    .replace(/bearer\s+[a-z0-9._~+/-]+=*/gi, 'Bearer ***')
    .replace(/\p{Cc}+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return clean ? clean.slice(0, 500) : null;
}

function toAuditRows(request: ImageSearchRequest, attempts: EngineAttempt[]) {
  return attempts.map((attempt) => ({
    requestId: request.requestId ?? null,
    comercioId: request.comercioId ?? null,
    userId: request.userId ?? null,
    providerSlug: attempt.slug,
    providerName: getImageProviderDefinition(attempt.slug)?.name ?? attempt.slug,
    status: attempt.status,
    requestedImages: attempt.requested ?? null,
    urlsCount: attempt.urls ?? 0,
    durationMs: attempt.durationMs ?? null,
    brand: request.brand,
    reference: request.reference,
    ean: request.ean,
    errorMessage: sanitizeAuditError(attempt.error)
  }));
}

// Default repository backed by the application database.
export const dbImageProviderRepository: ImageProviderRepository = {
  list: () => listImageProviders().map(toRecord),
  getLastCalled: () => getLastCalledImageProvider(),
  setLastCalled: (slug) => setLastCalledImageProvider(slug),
  recordCall: (slug, callsThisCycle, cycleStart) => {
    updateImageProvider(slug, { calls_this_cycle: callsThisCycle, cycle_start: cycleStart });
  },
  recordAttempts: (request, attempts) => {
    addImageProviderAuditLogs(toAuditRows(request, attempts));
  }
};
