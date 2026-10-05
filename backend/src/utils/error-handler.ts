// Centralized error handling for the Catalog AI backend

import { Request, Response, NextFunction } from 'express';
import { logger } from './logger';

export class AppError extends Error {
  statusCode: number;
  details?: any;
  code?: string;

  constructor(message: string, statusCode: number = 500, details?: any, code?: string) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.details = details;
    this.code = code;
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export class ErrorHandler {
  private static isDev = false;

  static setup(isDevelopment: boolean): void {
    ErrorHandler.isDev = isDevelopment;
  }

  static notFound(req: Request, res: Response, next: NextFunction): void {
    const error = new AppError(`Route not found: ${req.method} ${req.originalUrl}`, 404);
    next(error);
  }

  // Request context carried into every error log line so the operator can tell
  // which call failed without extra log lines: the HTTP method, the full URL and
  // the authenticated user/comercio when the request reached the auth middleware
  // (a body-parser error like 413 runs before auth, so only method/url appear).
  private static requestLogMeta(req: Request): Record<string, unknown> {
    const meta: Record<string, unknown> = {};
    if (req && req.method) meta.method = req.method;
    if (req && req.originalUrl) meta.url = req.originalUrl;
    const user = (req as any)?.user;
    if (user && typeof user === 'object') {
      if (user.username) meta.username = user.username;
      if (user.comercio_id !== undefined) meta.comercio_id = user.comercio_id;
    }
    return meta;
  }

  static handle(err: any, req: Request, res: Response, _next: NextFunction): void {
    const statusCode = err && err.statusCode ? err.statusCode : 500;
    const message = err && err.message ? err.message : 'Internal server error';
    // Body-parser marks oversized payloads (e.g. 413) with their type and the
    // byte limit that was configured, so the log shows the exact ceiling hit.
    const logMeta = {
      ...ErrorHandler.requestLogMeta(req),
      ...(err && err.type ? { type: err.type } : {}),
      ...(err && err.limit ? { limit: err.limit } : {})
    };

    if (statusCode >= 500) {
      logger.error('Unhandled error', {
        ...logMeta,
        message,
        stack: ErrorHandler.isDev && err ? err.stack : undefined
      });
    } else {
      logger.warn('Request error', { ...logMeta, message, statusCode });
    }

    // Never expose internal error details to the client
    const clientMessage = statusCode < 500 ? message : 'Internal server error';

    res.status(statusCode).json({
      success: false,
      error: {
        message: clientMessage,
        statusCode,
        ...(err && err.code ? { code: err.code } : {}),
        // Structured details for the cases where the client must react
        // differently to the same status code (e.g. the autocomplete quota
        // answering 429 for both "not enabled" and "limit reached"). Only ever
        // populated explicitly by the code that throws the AppError, so nothing
        // internal leaks through it.
        ...(err && err.details !== undefined ? { details: err.details } : {}),
        ...(ErrorHandler.isDev && err ? { stack: err.stack } : {})
      }
    });
  }
}
