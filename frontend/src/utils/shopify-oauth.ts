// Small browser-side helpers for the Shopify authorization flow. Any screen can
// send the user to the consent screen and come back to where it left off.

import { getApiError } from './download';

export function isShopifyOAuthRequired(error: unknown): boolean {
  return getApiError(error)?.code === 'SHOPIFY_OAUTH_REQUIRED';
}

// The callback appends `shopify=connected` to the path the flow started from.
// Keep only same-origin path + query: the backend validates this too.
export function shopifyReturnPath(): string {
  return `${window.location.pathname}${window.location.search}`;
}

export function hasShopifyConnectedFlag(): boolean {
  return new URLSearchParams(window.location.search).getAll('shopify').includes('connected');
}

export function clearShopifyConnectedFlag(): void {
  const params = new URLSearchParams(window.location.search);
  if (!params.getAll('shopify').includes('connected')) return;
  params.delete('shopify');
  const query = params.toString();
  window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
}
