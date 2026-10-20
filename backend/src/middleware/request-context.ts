// Global request context middleware.
// Assigns a unique request id (nonce) to every incoming HTTP request and makes
// it available in the log context so all logs produced while handling the
// request are correlated. Logs the completed request when the response finishes.
import { randomUUID } from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { getLogContext, withLogContext } from '../utils/log-context';
import { logger } from '../utils/logger';

declare module 'express-serve-static-core' {
  interface Request {
    requestId?: string;
  }
}

export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const requestId = randomUUID();
  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);

  const startedAt = Date.now();

  res.on('finish', () => {
    const durationMs = Date.now() - startedAt;
    const context = getLogContext();
    logger.info('HTTP request', {
      requestId,
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      durationMs,
      ...(context.comercioId !== undefined ? { comercioId: context.comercioId } : {}),
      ...(context.userId !== undefined ? { userId: context.userId } : {})
    });
  });

  const existing = getLogContext();
  withLogContext({ ...existing, requestId }, () => {
    next();
  });
}
