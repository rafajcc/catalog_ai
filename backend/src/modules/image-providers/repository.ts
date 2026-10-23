// Database-backed implementation of the engine's persistence port. It is the
// ONLY place of the image-search pipeline that touches auth/database: the
// engine takes an ImageProviderRepository, so swapping the storage never
// touches the orchestration code (and tests can inject an in-memory one).

import {
  getLastCalledImageProvider,
  ImageProviderRow,
  listImageProviders,
  setLastCalledImageProvider,
  updateImageProvider
} from '../auth/database';
import { ImageProviderRecord, ImageProviderRepository } from './types';

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

// Default repository backed by the application database.
export const dbImageProviderRepository: ImageProviderRepository = {
  list: () => listImageProviders().map(toRecord),
  getLastCalled: () => getLastCalledImageProvider(),
  setLastCalled: (slug) => setLastCalledImageProvider(slug),
  recordCall: (slug, callsThisCycle, cycleStart) => {
    updateImageProvider(slug, { calls_this_cycle: callsThisCycle, cycle_start: cycleStart });
  }
};
