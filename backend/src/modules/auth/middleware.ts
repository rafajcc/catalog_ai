// Express middleware: JWT cookie auth + role-based access control.

import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, TokenPayload } from './auth';
import { AppError } from '../../utils/error-handler';

declare global {
  namespace Express {
    interface Request {
      user?: TokenPayload;
    }
  }
}

/**
 * Extracts and validates the JWT access token from the httpOnly cookie.
 * Sets `req.user` on success, otherwise passes 401.
 */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = req.cookies?.access_token;
  if (!token) {
    return next(new AppError('Authentication required', 401));
  }
  try {
    req.user = verifyAccessToken(token);
    next();
  } catch {
    next(new AppError('Invalid or expired token', 401));
  }
}

/**
 * Returns middleware that rejects requests from users whose role is not in the
 * allowed list.  Must be used after `requireAuth`.
 */
export function requireRole(...roles: Array<'admin' | 'user'>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(new AppError('Authentication required', 401));
    }
    if (!roles.includes(req.user.role)) {
      return next(new AppError('Insufficient permissions', 403));
    }
    next();
  };
}
