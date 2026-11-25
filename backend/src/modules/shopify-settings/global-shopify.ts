// Global Shopify app credentials, shared by every comercio. They live in
// global_settings (not in the per-comercio config) because the Client ID and
// Client Secret identify Catalog AI itself. The browser only ever receives a
// masked hint for the secret.

import { SHOPIFY_DEFAULT_API_VERSION } from '../../store';
import { ShopifyConfig } from '../../types';
import { AppError } from '../../utils/error-handler';
import { maskSecret } from '../../utils/mask';
import { getGlobalSetting, setGlobalSetting } from '../auth/database';

// The app reads products, writes product data and uploads images via staged
// uploads, so it needs all three scopes.
export const SHOPIFY_OAUTH_SCOPES = 'read_products,write_products,write_files';

const KEY_CLIENT_ID = 'shopify_client_id';
const KEY_CLIENT_SECRET = 'shopify_client_secret';
const KEY_API_VERSION = 'shopify_api_version';

// Shopify versions use the YYYY-MM format. Accepting any quarter keeps the
// value future-proof without letting free text break the Admin API URL.
const API_VERSION_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export interface ShopifyGlobalSettings {
  client_id: string;
  client_secret: string;
  api_version: string;
}

export interface PublicShopifyGlobalSettings {
  client_id: string;
  has_client_secret: boolean;
  client_secret_hint: string | null;
  api_version: string;
  configured: boolean;
}

export function loadShopifyGlobalSettings(): ShopifyGlobalSettings {
  return {
    client_id: getGlobalSetting(KEY_CLIENT_ID) ?? '',
    client_secret: getGlobalSetting(KEY_CLIENT_SECRET) ?? '',
    api_version: getGlobalSetting(KEY_API_VERSION) || SHOPIFY_DEFAULT_API_VERSION
  };
}

export function toPublicShopifyGlobalSettings(
  settings: ShopifyGlobalSettings = loadShopifyGlobalSettings()
): PublicShopifyGlobalSettings {
  return {
    client_id: settings.client_id,
    has_client_secret: Boolean(settings.client_secret),
    client_secret_hint: maskSecret(settings.client_secret),
    api_version: settings.api_version,
    configured: Boolean(settings.client_id && settings.client_secret)
  };
}

// Empty strings mean "keep the stored value"; `null` clears the field. This is
// the same contract used by the global AI provider form, so the super admin
// can rotate a secret without retyping the other fields.
function normalizeField(value: unknown, current: string, clearValue = ''): string {
  if (value === null) return clearValue;
  if (typeof value !== 'string') return current;
  const trimmed = value.trim();
  return trimmed || current;
}

export function saveShopifyGlobalSettings(body: Record<string, unknown>): PublicShopifyGlobalSettings {
  const current = loadShopifyGlobalSettings();
  const next: ShopifyGlobalSettings = {
    client_id: normalizeField(body.client_id, current.client_id),
    client_secret: normalizeField(body.client_secret, current.client_secret),
    api_version: normalizeField(body.api_version, current.api_version, SHOPIFY_DEFAULT_API_VERSION)
  };

  if (!API_VERSION_PATTERN.test(next.api_version)) {
    throw new AppError('Shopify API version must use the YYYY-MM format', 400);
  }

  setGlobalSetting(KEY_CLIENT_ID, next.client_id);
  setGlobalSetting(KEY_CLIENT_SECRET, next.client_secret);
  setGlobalSetting(KEY_API_VERSION, next.api_version);
  return toPublicShopifyGlobalSettings(next);
}

export interface ShopifyAppCredentials {
  client_id: string;
  client_secret: string;
  api_version: string;
}

// A comercio that brought its own Shopify app authenticates with its own
// credentials and may pin its own API version; an empty override inherits the
// global one. Every other comercio always uses the platform-wide app.
export function resolveShopifyAppCredentials(
  config: Pick<ShopifyConfig, 'own_app' | 'client_id' | 'client_secret' | 'api_version'>
): ShopifyAppCredentials {
  const global = loadShopifyGlobalSettings();
  return config.own_app
    ? {
        client_id: config.client_id,
        client_secret: config.client_secret,
        api_version: config.api_version?.trim() || global.api_version
      }
    : global;
}

// The callback URL must match the Dev Dashboard byte for byte. Deriving it from
// the request keeps local and production working with one build; setting
// SHOPIFY_REDIRECT_URI pins it for deployments behind a proxy with a different
// public address.
export function resolveShopifyRedirectUri(
  headers: { host?: string; 'x-forwarded-proto'?: string | string[] },
  protocol: string
): string {
  const configured = process.env.SHOPIFY_REDIRECT_URI?.trim();
  if (configured) return configured;
  const forwarded = headers['x-forwarded-proto'];
  const forwardedProto = (Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0])?.trim();
  const host = headers.host || 'localhost:3000';
  return `${forwardedProto || protocol}://${host}/api/shopify/oauth/callback`;
}
