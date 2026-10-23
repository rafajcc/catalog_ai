// Rate limiting specific to the public API (/api/public/*).
//
// Two layers, both stricter than the global IP limiter in app.ts (which stays as
// an outer safety net but is too weak and, more importantly, keyed only by IP):
//
//  1. `publicIpLimiter` runs BEFORE `requireApiKey`, keyed by IP. Its job is to
//     blunt brute-force guessing of API keys, where no valid comercio is known
//     yet. A generous-but-concrete ceiling.
//  2. `publicComercioLimiter` runs AFTER `requireApiKey`, keyed by the resolved
//     comercio id. This is the real M2M identity: a whole PrestaShop module or
//     Shopify app shares one bucket regardless of the IP it comes from, and two
//     comercios behind the same NAT never share a bucket.
//
// The 429 body is forced into the app-wide {success:false,error:{...}} shape, so
// a client parses rate-limit errors exactly like any other error.

import { NextFunction, Request, Response } from 'express';
import rateLimit, { Options } from 'express-rate-limit';
import { logRateLimitDenial, RateLimitScope } from '../../utils/rate-limit-log';

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX = 60;

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

// The shared 429 payload: same envelope the error handler uses, so the public
// module answers rate-limit errors identically to every other error. It also logs
// the denial, so a refused request is visible in the application log and not
// only as a bare 429 in the access log.
function tooManyRequests(
  scope: RateLimitScope,
  keyOf: (req: Request) => string,
  max: number,
  windowMs: number
) {
  return (req: Request, res: Response, _next: NextFunction): void => {
    logRateLimitDenial(req, { scope, key: keyOf(req), limit: max, windowMs });
    res.status(429).json({
      success: false,
      error: {
        message: 'Too many requests. Please retry later.',
        statusCode: 429,
        code: 'rate_limited'
      }
    });
  };
}

function baseOptions(
  scope: RateLimitScope,
  keyOf: (req: Request) => string,
  max: number
): Partial<Options> {
  const windowMs = envInt('PUBLIC_RATE_LIMIT_WINDOW_MS', DEFAULT_WINDOW_MS);
  return {
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    handler: tooManyRequests(scope, keyOf, max, windowMs)
  };
}

// Identifies the caller by IP before the key is known (brute-force guard).
export function createPublicIpLimiter(max = envInt('PUBLIC_RATE_LIMIT_MAX', DEFAULT_MAX)) {
  return rateLimit(baseOptions('public_ip', (req) => req.ip || 'unknown', max));
}

// Identifies the caller by the comercio resolved from its API key: the real M2M
// identity, stable across IPs. Mounted after requireApiKey, so req.apiKey exists.
export function createPublicComercioLimiter(
  max = envInt('PUBLIC_RATE_LIMIT_COMERCIO_MAX', envInt('PUBLIC_RATE_LIMIT_MAX', DEFAULT_MAX))
) {
  const keyOf = (req: Request) => `comercio:${req.apiKey?.comercioId ?? 'unknown'}`;
  return rateLimit({
    ...baseOptions('public_comercio', keyOf, max),
    keyGenerator: keyOf
  });
}

export const publicIpLimiter = createPublicIpLimiter();
export const publicComercioLimiter = createPublicComercioLimiter();
