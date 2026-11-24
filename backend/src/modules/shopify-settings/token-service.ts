// Exchanges Shopify OAuth codes and keeps access tokens fresh. Expiring tokens
// last one hour and their refresh tokens ninety days; Shopify rotates the
// refresh token on every renewal, so the new one must be persisted immediately.
// The API version is always taken from the global super-admin settings.

import axios from 'axios';
import { ShopifyConfig } from '../../types';
import { AppError } from '../../utils/error-handler';
import { DatabasePersistence } from '../database-persistence/database-persistence';
import { resolveShopifyAppCredentials, ShopifyAppCredentials } from './global-shopify';

// Renew a little before the actual expiry so a fetch that starts at the last
// second does not fail against Shopify.
const REFRESH_MARGIN_MS = 5 * 60 * 1000;
const TOKEN_TIMEOUT_MS = 15000;

export interface ShopifyTokenResponse {
  access_token: string;
  scope?: string;
  refresh_token?: string;
  expires_in?: number;
  refresh_token_expires_in?: number;
}

async function postToken(shop: string, body: Record<string, unknown>): Promise<ShopifyTokenResponse> {
  if (!shop) throw new AppError('El dominio de la tienda de Shopify es obligatorio', 400);
  try {
    const res = await axios.post<ShopifyTokenResponse>(
      `https://${shop}/admin/oauth/access_token`,
      body,
      { timeout: TOKEN_TIMEOUT_MS, headers: { 'Content-Type': 'application/json' } }
    );
    if (!res.data?.access_token) {
      throw new AppError('Shopify no devolvió un token de acceso', 400);
    }
    return res.data;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('No se pudo obtener el token de acceso de Shopify', 400);
  }
}

export function exchangeShopifyCode(
  shop: string,
  app: ShopifyAppCredentials,
  code: string
): Promise<ShopifyTokenResponse> {
  return postToken(shop, {
    client_id: app.client_id,
    client_secret: app.client_secret,
    code
  });
}

export function refreshShopifyAccessToken(
  shop: string,
  app: ShopifyAppCredentials,
  refreshToken: string
): Promise<ShopifyTokenResponse> {
  return postToken(shop, {
    grant_type: 'refresh_token',
    client_id: app.client_id,
    client_secret: app.client_secret,
    refresh_token: refreshToken
  });
}

function isoFromNow(seconds: number): string {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

function applyTokenResponse(config: ShopifyConfig, tokens: ShopifyTokenResponse): ShopifyConfig {
  return {
    ...config,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token || config.refresh_token,
    scope: tokens.scope || config.scope,
    expires_at: tokens.expires_in ? isoFromNow(tokens.expires_in) : config.expires_at,
    refresh_token_expires_at: tokens.refresh_token_expires_in
      ? isoFromNow(tokens.refresh_token_expires_in)
      : config.refresh_token_expires_at
  };
}

export function saveShopifyTokens(comercioId: number, tokens: ShopifyTokenResponse): void {
  const persistence = new DatabasePersistence(comercioId);
  const config = persistence.load();
  if (!config) return;
  persistence.save({ ...config, shopify: applyTokenResponse(config.shopify, tokens) });
}

// Turns a stored per-comercio config into the config the HTTP client needs:
// with the global API version and a token that is valid for at least five more
// minutes. A legacy token with no expiry is treated as non-expiring.
export async function prepareShopifyRuntimeConfig(config: ShopifyConfig): Promise<ShopifyConfig> {
  const app = resolveShopifyAppCredentials(config);
  const expiresAt = config.expires_at ? Date.parse(config.expires_at) : NaN;
  const validUntil = Number.isFinite(expiresAt) ? expiresAt : Infinity;
  const mustRefresh = !config.access_token || validUntil - Date.now() < REFRESH_MARGIN_MS;

  if (!mustRefresh) {
    return { ...config, api_version: app.api_version };
  }

  if (!config.refresh_token) {
    if (config.access_token && !Number.isFinite(expiresAt)) {
      // Old custom-app tokens never expire: keep working until the comercio
      // explicitly reconnects with the OAuth flow.
      return { ...config, api_version: app.api_version };
    }
    throw new AppError('Shopify no está conectado o la sesión ha caducado. Vuelve a conectar la tienda.', 400);
  }

  if (!app.client_id || !app.client_secret) {
    throw new AppError('Faltan credenciales de la app de Shopify', 400);
  }

  const tokens = await refreshShopifyAccessToken(config.shop_domain, app, config.refresh_token);
  if (config.comercio_id) {
    saveShopifyTokens(config.comercio_id, tokens);
  }
  return {
    ...applyTokenResponse(config, tokens),
    api_version: app.api_version
  };
}
