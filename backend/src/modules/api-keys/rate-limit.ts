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

import { Request, Response } from 'express';
import rateLimit, { Options } from 'express-rate-limit';

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX = 60;

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

// The shared 429 payload: same envelope the error handler uses, so the public
// module answers rate-limit errors identically to every other error.
function tooManyRequests(_req: Request, res: Response): void {
  res.status(429).json({
    success: false,
    error: {
      message: 'Too many requests. Please retry later.',
      statusCode: 429,
      code: 'rate_limited'
    }
  });
}

function baseOptions(max: number): Partial<Options> {
  return {
    windowMs: envInt('PUBLIC_RATE_LIMIT_WINDOW_MS', DEFAULT_WINDOW_MS),
    max,
    standardHeaders: true,
    legacyHeaders: false,
    handler: tooManyRequests
  };
}

// Identifies the caller by IP before the key is known (brute-force guard).
export function createPublicIpLimiter(max = envInt('PUBLIC_RATE_LIMIT_MAX', DEFAULT_MAX)) {
  return rateLimit(baseOptions(max));
}

// Identifies the caller by the comercio resolved from its API key: the real M2M
// identity, stable across IPs. Mounted after requireApiKey, so req.apiKey exists.
export function createPublicComercioLimiter(
  max = envInt('PUBLIC_RATE_LIMIT_COMERCIO_MAX', envInt('PUBLIC_RATE_LIMIT_MAX', DEFAULT_MAX))
) {
  return rateLimit({
    ...baseOptions(max),
    keyGenerator: (req: Request) => `comercio:${req.apiKey?.comercioId ?? 'unknown'}`
  });
}

export const publicIpLimiter = createPublicIpLimiter();
export const publicComercioLimiter = createPublicComercioLimiter();
