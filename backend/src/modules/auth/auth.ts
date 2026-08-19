// Authentication logic: password hashing, JWT tokens, input validation.

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { AppError } from '../../utils/error-handler';

const BCRYPT_ROUNDS = 12;
const JWT_EXPIRY = '1h';
const JWT_REFRESH_EXPIRY = '7d';

// In production this should come from an environment variable or a generated
// secret file.  The fallback is only suitable for development.
const JWT_SECRET = process.env.JWT_SECRET || 'catalog-ai-dev-secret-change-in-production';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'catalog-ai-dev-refresh-secret-change-in-production';

// ── Passwords ────────────────────────────────────────────────────────────────

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export async function comparePassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

// OWASP: minimum 8 characters, at least one uppercase, one lowercase, one digit.
const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;

export function validatePasswordStrength(password: string): void {
  if (!PASSWORD_REGEX.test(password)) {
    throw new AppError(
      'Password must be at least 8 characters and contain at least one uppercase letter, one lowercase letter and one digit',
      400
    );
  }
}

const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,30}$/;

export function validateUsername(username: string): void {
  if (!USERNAME_REGEX.test(username)) {
    throw new AppError(
      'Username must be 3-30 characters and contain only letters, digits and underscores',
      400
    );
  }
}

// ── JWT ──────────────────────────────────────────────────────────────────────

export interface TokenPayload {
  sub: number;
  username: string;
  role: 'admin' | 'user';
  comercio_id: number;
  comercio_slug: string;
}

export function signAccessToken(payload: TokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRY });
}

export function signRefreshToken(payload: TokenPayload): string {
  return jwt.sign({ ...payload, type: 'refresh' }, JWT_REFRESH_SECRET, { expiresIn: JWT_REFRESH_EXPIRY });
}

export function verifyAccessToken(token: string): TokenPayload {
  try {
    return jwt.verify(token, JWT_SECRET) as unknown as TokenPayload;
  } catch {
    throw new AppError('Invalid or expired token', 401);
  }
}

export function verifyRefreshToken(token: string): TokenPayload {
  try {
    const decoded = jwt.verify(token, JWT_REFRESH_SECRET) as unknown as TokenPayload & { type: string };
    if (decoded.type !== 'refresh') throw new AppError('Invalid token type', 401);
    return decoded;
  } catch {
    throw new AppError('Invalid or expired refresh token', 401);
  }
}

// ── Cookie helpers ───────────────────────────────────────────────────────────

const IS_PROD = process.env.NODE_ENV === 'production';

export function setAuthCookies(res: any, accessToken: string, refreshToken: string): void {
  res.cookie('access_token', accessToken, {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: 'strict',
    maxAge: 60 * 60 * 1000 // 1 hour
  });
  res.cookie('refresh_token', refreshToken, {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: 'strict',
    path: '/api/auth/refresh',
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  });
}

export function clearAuthCookies(res: any): void {
  res.clearCookie('access_token');
  res.clearCookie('refresh_token', { path: '/api/auth/refresh' });
}
