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

  static handle(err: any, req: Request, res: Response, _next: NextFunction): void {
    const statusCode = err && err.statusCode ? err.statusCode : 500;
    const message = err && err.message ? err.message : 'Internal server error';

    if (statusCode >= 500) {
      logger.error('Unhandled error', {
        message,
        stack: ErrorHandler.isDev && err ? err.stack : undefined
      });
    } else {
      logger.warn('Request error', { message, statusCode });
    }

    res.status(statusCode).json({
      success: false,
      error: {
        message,
        statusCode,
        details: err && err.details,
        ...(err && err.code ? { code: err.code } : {}),
        ...(ErrorHandler.isDev && err ? { stack: err.stack } : {})
      }
    });
  }
}
