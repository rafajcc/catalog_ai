// Shared logging for every rate-limit denial in the app.
//
// express-rate-limit answers a refused request with a silent 429 unless it is
// given a custom handler. Without an explicit line, the only trace of a denial
// is the bare status code in the access log, which does not say which bucket was
// exhausted, how many hits it had or when it resets — and is indistinguishable
// from the other 429s the app returns (login lockout, autocomplete quota).
//
// Every limiter funnels its denials through this helper so an operator can tell
// from the application log alone that the service was denied by the rate limit
// and which identity (IP or comercio) hit the ceiling.

import { Request } from 'express';
import { logger } from './logger';

// Which limiter refused the request:
//  - global_ip:       the coarse /api limiter in app.ts, keyed by IP.
//  - public_ip:       the public API limiter that runs before the key is known.
//  - public_comercio: the public API limiter keyed by the resolved comercio.
export type RateLimitScope = 'global_ip' | 'public_ip' | 'public_comercio';

export interface RateLimitDenial {
  scope: RateLimitScope;
  // The bucket key the limiter counted against (an IP, or `comercio:<id>`).
  key: string;
  // The ceiling and the window of the bucket that was exhausted.
  limit: number;
  windowMs: number;
}

// Shape express-rate-limit leaves on the request before calling the handler.
interface RateLimitInfo {
  current?: number;
  remaining?: number;
  resetTime?: Date;
}

/**
 * Writes one warn line stating that the rate limit denied the request, with the
 * bucket identity, the hits seen, the ceiling and when the bucket resets.
 */
export function logRateLimitDenial(req: Request, denial: RateLimitDenial): void {
  const info = (req as Request & { rateLimit?: RateLimitInfo }).rateLimit;

  logger.warn('Rate limit exceeded, request denied', {
    scope: denial.scope,
    key: denial.key,
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
    // The raw proxy headers are logged on purpose: when every client resolves to
    // the same req.ip (reverse proxy / trust proxy mismatch), these are the
    // values that reveal it.
    forwardedFor: req.get('x-forwarded-for'),
    realIp: req.get('x-real-ip'),
    limit: denial.limit,
    hits: info?.current,
    remaining: info?.remaining,
    windowMs: denial.windowMs,
    resetAt: info?.resetTime ? info.resetTime.toISOString() : undefined
  });
}
