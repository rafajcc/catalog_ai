// Express middleware: JWT cookie auth + role-based access control.

import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, TokenPayload, AuthRole } from './auth';
import { findComercioById, findUserById } from './database';
import { getSuperAdminConfig, isSuperAdminConfigured } from './super-admin';
import { AppError } from '../../utils/error-handler';
import { withLogContext } from '../../utils/log-context';

declare global {
  namespace Express {
    interface Request {
      user?: TokenPayload;
    }
  }
}

// A user that was created or whose password was reset by an admin (or the
// super admin) must pick a new password before doing anything else. These
// paths are the only ones that stay reachable until that happens.
const PASSWORD_CHANGE_ALLOWED_PATHS = new Set(['/me', '/change-password', '/logout']);

function isPasswordChangeExempt(req: Request): boolean {
  return PASSWORD_CHANGE_ALLOWED_PATHS.has(req.path);
}

/**
 * Extracts and validates the JWT access token from the httpOnly cookie.
 * Sets `req.user` on success, otherwise passes 401.
 *
 * Beyond token validity it also re-checks, on every request, the state the
 * token cannot revoke:
 *  - the comercio still exists and is active (a disabled comercio locks all
 *    of its users out immediately, including sessions that were already open),
 *  - the user row still exists and is active (a disabled user loses access on
 *    the next request, even with an open session),
 *  - the user currently has no "change your password" requirement (only
 *    /me, /change-password and /logout stay reachable while it is pending).
 * The super admin has no DB row: it is validated against the environment
 * variables, so its tokens stop working if the account is removed.
 */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = req.cookies?.access_token;
  if (!token) {
    return next(new AppError('Authentication required', 401));
  }
  try {
    const payload = verifyAccessToken(token);
    req.user = payload;

    if (payload.role === 'superadmin') {
      if (!isSuperAdminConfigured() || getSuperAdminConfig().username !== payload.username) {
        return next(new AppError('Super admin no longer configured', 401));
      }
      return wrapContextAndNext(payload, next);
    }

    const comercio = findComercioById(payload.comercio_id);
    if (!comercio || comercio.active !== 1) {
      return next(new AppError('Comercio is disabled', 403));
    }

    const user = findUserById(payload.sub);
    if (!user) {
      return next(new AppError('User no longer exists', 401));
    }

    if (user.active !== 1) {
      return next(new AppError('Account is disabled by the administrator', 403));
    }

    if (user.must_change_password === 1 && !isPasswordChangeExempt(req)) {
      return next(new AppError('Password change required before using the platform', 403));
    }

    return wrapContextAndNext(payload, next);
  } catch {
    next(new AppError('Invalid or expired token', 401));
  }
}

function wrapContextAndNext(payload: TokenPayload, next: NextFunction): void {
  // Every log line emitted while handling this request is tagged with the
  // comercio and user that own it (AsyncLocalStorage propagates through the
  // async handlers and the AI/prestaShop calls they await).
  withLogContext({ comercioId: payload.comercio_id, userId: payload.sub, username: payload.username }, () => {
    next();
  });
}

/**
 * Returns middleware that rejects requests from users whose role is not in the
 * allowed list.  Must be used after `requireAuth`.
 */
export function requireRole(...roles: AuthRole[]) {
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