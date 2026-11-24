// OAuth authorization-code flow for Shopify. The merchant starts it from the
// configuration screen (so we know which shop and which app credentials to
// use) and Shopify redirects the browser back here with a one-time code. The
// callback needs no session: the signed-in state is represented by the single
// use `state` value stored when the flow started.

import { NextFunction, Request, Response, Router } from 'express';
import { AppError } from '../../utils/error-handler';
import { requireAuth } from '../auth/middleware';
import { DatabasePersistence } from '../database-persistence/database-persistence';
import {
  resolveShopifyAppCredentials,
  resolveShopifyRedirectUri,
  SHOPIFY_OAUTH_SCOPES
} from './global-shopify';
import { consumeShopifyOAuthState, createShopifyOAuthState, sanitizeOAuthReturnTo } from './oauth-state';
import { exchangeShopifyCode, saveShopifyTokens } from './token-service';

type AsyncHandler = (req: Request, res: Response) => Promise<void>;
const wrap = (fn: AsyncHandler) => (req: Request, res: Response, next: NextFunction): void => {
  fn(req, res).catch(next);
};

const router = Router();

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]!);
}

function callbackPage(ok: boolean, message: string): string {
  const color = ok ? '#15803d' : '#b91c1c';
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Shopify — Catalog AI</title><style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f9fafb;color:#111827}main{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:2rem;max-width:28rem;text-align:center}h1{font-size:1.25rem;color:${color}}a{display:inline-block;margin-top:1rem;color:#2563eb}</style></head><body><main><h1>${escapeHtml(message)}</h1><a href="/">Volver a Catalog AI</a></main></body></html>`;
}

// Any authenticated user of the comercio may trigger the consent screen: the
// Shopify login (with or without admin rights on the shop) is Shopify's own
// concern, not an app role.
router.get('/start', requireAuth, (req: Request, res: Response) => {
  const comercioId = Number(req.user!.comercio_id);
  const config = new DatabasePersistence(comercioId).load()?.shopify;
  if (!config?.shop_domain) {
    throw new AppError('Configura el dominio de la tienda antes de conectar Shopify', 400);
  }
  const app = resolveShopifyAppCredentials(config);
  if (!app.client_id || !app.client_secret) {
    throw new AppError('Faltan credenciales de la app de Shopify', 400);
  }

  const state = createShopifyOAuthState(comercioId, sanitizeOAuthReturnTo(req.query.return_to));
  const url = new URL(`https://${config.shop_domain}/admin/oauth/authorize`);
  url.searchParams.set('client_id', app.client_id);
  url.searchParams.set('scope', SHOPIFY_OAUTH_SCOPES);
  url.searchParams.set('redirect_uri', resolveShopifyRedirectUri(req.headers, req.protocol));
  url.searchParams.set('state', state);
  url.searchParams.set('grant_options[]', 'expiring');
  // Shopify's `expiring` grant option is also accepted as expiring=1 by the
  // installing link; both are sent so the meaning is explicit in the URL.
  url.searchParams.set('expiring', '1');
  res.redirect(url.toString());
});

router.get('/callback', wrap(async (req: Request, res: Response) => {
  const state = String(req.query.state ?? '');
  const code = String(req.query.code ?? '');
  const oauthState = consumeShopifyOAuthState(state);
  if (!oauthState) {
    res.status(400).send(callbackPage(false, 'Estado de conexión inválido o caducado'));
    return;
  }
  if (!code) {
    res.status(400).send(callbackPage(false, 'Shopify rechazó la conexión'));
    return;
  }

  try {
    const config = new DatabasePersistence(oauthState.comercio_id).load()?.shopify;
    if (!config?.shop_domain) {
      throw new AppError('No se encontró el dominio de la tienda', 400);
    }
    const app = resolveShopifyAppCredentials(config);
    if (!app.client_id || !app.client_secret) {
      throw new AppError('Faltan credenciales de la app de Shopify', 400);
    }
    const tokens = await exchangeShopifyCode(config.shop_domain, app, code);
    saveShopifyTokens(oauthState.comercio_id, tokens);
    // A flow started from the search screen carries a local return path so the
    // browser lands back there and the pending action can be retried.
    if (oauthState.return_to) {
      const separator = oauthState.return_to.includes('?') ? '&' : '?';
      res.redirect(`${oauthState.return_to}${separator}shopify=connected`);
      return;
    }
    res.send(callbackPage(true, `Tienda ${config.shop_domain} conectada`));
  } catch (error) {
    const message = error instanceof AppError ? error.message : 'No se pudo completar la conexión con Shopify';
    res.status(400).send(callbackPage(false, message));
  }
}));

export default router;
