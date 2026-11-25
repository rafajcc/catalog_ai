// One-time state for the Shopify OAuth redirect. The merchant is logged in when
// the flow starts, but the callback is a plain browser redirect from Shopify, so
// the state itself carries the comercio id (and optionally a local return path)
// instead of relying on a session. States are kept in global_settings as a small
// JSON map and expire after ten minutes; each one is consumed only once.

import { randomBytes } from 'crypto';
import { getGlobalSetting, setGlobalSetting } from '../auth/database';

const STATE_KEY = 'shopify_oauth_states';
const STATE_TTL_MS = 10 * 60 * 1000;

interface StoredState {
  comercio_id: number;
  created_at: number;
  return_to?: string;
}

export interface ShopifyOAuthState {
  comercio_id: number;
  return_to?: string;
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

// Only same-origin paths may be stored, so a crafted `return_to` can never turn
// the OAuth callback into an open redirect. Fragments are dropped because the
// callback appends its own query string.
export function sanitizeOAuthReturnTo(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
    return undefined;
  }
  try {
    const url = new URL(value, 'http://localhost');
    if (url.origin !== 'http://localhost') return undefined;
    return `${url.pathname}${url.search}`;
  } catch {
    return undefined;
  }
}

export function createShopifyOAuthState(comercioId: number, returnTo?: string): string {
  const states = loadStates();
  const now = Date.now();
  for (const [state, entry] of Object.entries(states)) {
    if (now - entry.created_at > STATE_TTL_MS) delete states[state];
  }

  const state = randomBytes(24).toString('hex');
  states[state] = {
    comercio_id: comercioId,
    created_at: now,
    ...(returnTo ? { return_to: returnTo } : {})
  };
  saveStates(states);
  return state;
}

export function consumeShopifyOAuthState(state: string): ShopifyOAuthState | undefined {
  if (!state) return undefined;
  const states = loadStates();
  const entry = states[state];
  if (!entry) return undefined;
  delete states[state];
  saveStates(states);
  if (Date.now() - entry.created_at > STATE_TTL_MS) return undefined;
  return { comercio_id: entry.comercio_id, ...(entry.return_to ? { return_to: entry.return_to } : {}) };
}
