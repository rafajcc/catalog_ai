// One-time state for the Shopify OAuth redirect. The merchant is logged in when
// the flow starts, but the callback is a plain browser redirect from Shopify, so
// the state itself carries the comercio id instead of relying on a session.
// States are kept in global_settings as a small JSON map and expire after ten
// minutes; each one is deleted as soon as it is consumed.

import { randomBytes } from 'crypto';
import { getGlobalSetting, setGlobalSetting } from '../auth/database';

const STATE_KEY = 'shopify_oauth_states';
const STATE_TTL_MS = 10 * 60 * 1000;

interface StoredState {
  comercio_id: number;
  created_at: number;
}

function loadStates(): Record<string, StoredState> {
  const raw = getGlobalSetting(STATE_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, StoredState>;
  } catch {
    return {};
  }
}

function saveStates(states: Record<string, StoredState>): void {
  setGlobalSetting(STATE_KEY, JSON.stringify(states));
}

export function createShopifyOAuthState(comercioId: number): string {
  const states = loadStates();
  const now = Date.now();
  for (const [state, entry] of Object.entries(states)) {
    if (now - entry.created_at > STATE_TTL_MS) delete states[state];
  }

  const state = randomBytes(24).toString('hex');
  states[state] = { comercio_id: comercioId, created_at: now };
  saveStates(states);
  return state;
}

export function consumeShopifyOAuthState(state: string): number | undefined {
  if (!state) return undefined;
  const states = loadStates();
  const entry = states[state];
  if (!entry) return undefined;
  delete states[state];
  saveStates(states);
  return Date.now() - entry.created_at <= STATE_TTL_MS ? entry.comercio_id : undefined;
}
