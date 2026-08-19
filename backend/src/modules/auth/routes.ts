// Auth routes: login, logout, token refresh, user management (admin only),
// and comercio listing (public for login form).

import { Router, Request, Response } from 'express';
import { AppError } from '../../utils/error-handler';
import {
  hashPassword,
  comparePassword,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  setAuthCookies,
  clearAuthCookies,
  validatePasswordStrength,
  validateUsername
} from './auth';
import {
  findUserByUsername,
  findUserByUsernameGlobal,
  findUserById,
  listUsers,
  createUser,
  updateUser,
  deleteUser,
  findComercioBySlug,
  findComercioById,
  createComercio,
  listComercios,
  recordLoginAttempt,
  isAccountLocked
} from './database';
import { requireAuth, requireRole } from './middleware';

const router = Router();

// ── Public ───────────────────────────────────────────────────────────────────

// Register a new comercio with its admin user (public, first-run flow).
router.post('/register-comercio', async (req: Request, res: Response) => {
  const { comercio_name, admin_username, admin_password } = req.body;

  if (!comercio_name || !admin_username || !admin_password) {
    throw new AppError('Comercio name, admin username and admin password are required', 400);
  }

  const name = String(comercio_name).trim();
  const username = String(admin_username).trim();
  const password = String(admin_password);

  if (name.length < 2 || name.length > 100) {
    throw new AppError('Comercio name must be between 2 and 100 characters', 400);
  }

  // Generate slug from name: lowercase, replace spaces/special chars with hyphens
  const slug = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

  if (!slug) {
    throw new AppError('Could not generate a valid slug from the comercio name', 400);
  }

  if (findComercioBySlug(slug)) {
    throw new AppError('A comercio with a similar name already exists', 409);
  }

  validateUsername(username);
  validatePasswordStrength(password);

  // Create comercio
  const comercio = createComercio(name, slug);

  // Create admin user
  const passwordHash = await hashPassword(password);
  createUser(username, passwordHash, 'admin', comercio.id);

  // Auto-login: issue tokens
  const user = findUserByUsername(username, comercio.id)!;
  const payload = {
    sub: user.id,
    username: user.username,
    role: user.role,
    comercio_id: user.comercio_id,
    comercio_slug: comercio.slug
  };
  const accessToken = signAccessToken(payload);
  const refreshToken = signRefreshToken(payload);
  setAuthCookies(res, accessToken, refreshToken);

  res.status(201).json({
    success: true,
    user: { id: user.id, username: user.username, role: user.role, comercio_id: user.comercio_id, comercio_slug: comercio.slug }
  });
});

// Login: accepts { username, password } — the comercio is derived from the user.
router.post('/login', async (req: Request, res: Response) => {
  const { username, password } = req.body;
  if (!username || !password) {
    throw new AppError('Username and password are required', 400);
  }

  if (isAccountLocked(String(username))) {
    throw new AppError('Account is temporarily locked due to too many failed attempts', 429);
  }

  const user = findUserByUsernameGlobal(String(username));
  if (!user) {
    recordLoginAttempt(String(username), undefined, req.ip, false);
    throw new AppError('Invalid credentials', 401);
  }

  const valid = await comparePassword(String(password), user.password_hash);
  if (!valid) {
    recordLoginAttempt(String(username), undefined, req.ip, false);
    throw new AppError('Invalid credentials', 401);
  }

  const comercio = findComercioById(user.comercio_id);
  if (!comercio) {
    throw new AppError('User comercio not found', 500);
  }

  recordLoginAttempt(String(username), comercio.slug, req.ip, true);

  const payload = {
    sub: user.id,
    username: user.username,
    role: user.role,
    comercio_id: user.comercio_id,
    comercio_slug: comercio.slug
  };
  const accessToken = signAccessToken(payload);
  const refreshToken = signRefreshToken(payload);

  setAuthCookies(res, accessToken, refreshToken);

  res.json({
    success: true,
    user: { id: user.id, username: user.username, role: user.role, comercio_id: user.comercio_id, comercio_slug: comercio.slug }
  });
});

router.post('/logout', (_req: Request, res: Response) => {
  clearAuthCookies(res);
  res.json({ success: true });
});

router.post('/refresh', (req: Request, res: Response) => {
  const token = req.cookies?.refresh_token;
  if (!token) {
    throw new AppError('Refresh token required', 401);
  }
  const decoded = verifyRefreshToken(token);
  const user = findUserById(decoded.sub);
  if (!user) {
    throw new AppError('User not found', 401);
  }

  const payload = {
    sub: user.id,
    username: user.username,
    role: user.role,
    comercio_id: user.comercio_id,
    comercio_slug: decoded.comercio_slug
  };
  const accessToken = signAccessToken(payload);
  const newRefreshToken = signRefreshToken(payload);

  setAuthCookies(res, accessToken, newRefreshToken);

  res.json({
    success: true,
    user: { id: user.id, username: user.username, role: user.role, comercio_id: user.comercio_id, comercio_slug: decoded.comercio_slug }
  });
});

// ── Current user ─────────────────────────────────────────────────────────────

router.get('/me', requireAuth, (req: Request, res: Response) => {
  const user = findUserById(req.user!.sub);
  if (!user) {
    throw new AppError('User not found', 404);
  }
  res.json({
    success: true,
    user: { id: user.id, username: user.username, role: user.role, comercio_id: user.comercio_id, comercio_slug: req.user!.comercio_slug }
  });
});

// ── User management (admin only, scoped to current comercio) ────────────────

router.get('/users', requireAuth, requireRole('admin'), (req: Request, res: Response) => {
  res.json({ success: true, users: listUsers(req.user!.comercio_id) });
});

router.post('/users', requireAuth, requireRole('admin'), async (req: Request, res: Response) => {
  const { username, password, role } = req.body;

  validateUsername(String(username));
  validatePasswordStrength(String(password));

  const validRole = role === 'admin' || role === 'user' ? role : 'user';
  const passwordHash = await hashPassword(String(password));

  const user = createUser(String(username), passwordHash, validRole, req.user!.comercio_id);

  res.status(201).json({
    success: true,
    user: { id: user.id, username: user.username, role: user.role, comercio_id: user.comercio_id }
  });
});

router.put('/users/:id', requireAuth, requireRole('admin'), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const existing = findUserById(id);
  if (!existing || existing.comercio_id !== req.user!.comercio_id) {
    throw new AppError('User not found', 404);
  }

  const fields: { password_hash?: string; role?: 'admin' | 'user' } = {};

  if (req.body.password) {
    validatePasswordStrength(String(req.body.password));
    fields.password_hash = await hashPassword(String(req.body.password));
  }

  if (req.body.role) {
    const validRole = req.body.role === 'admin' || req.body.role === 'user' ? req.body.role : undefined;
    if (validRole) fields.role = validRole;
  }

  updateUser(id, fields);

  const updated = findUserById(id)!;
  res.json({
    success: true,
    user: { id: updated.id, username: updated.username, role: updated.role, comercio_id: updated.comercio_id }
  });
});

router.delete('/users/:id', requireAuth, requireRole('admin'), (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const user = findUserById(id);
  if (!user || user.comercio_id !== req.user!.comercio_id) {
    throw new AppError('User not found', 404);
  }
  // Prevent deleting yourself
  if (user.id === req.user!.sub) {
    throw new AppError('Cannot delete your own account', 400);
  }
  deleteUser(id);
  res.json({ success: true });
});

// ── Change own password ──────────────────────────────────────────────────────

router.put('/change-password', requireAuth, async (req: Request, res: Response) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    throw new AppError('Current and new passwords are required', 400);
  }

  const user = findUserById(req.user!.sub);
  if (!user) {
    throw new AppError('User not found', 404);
  }

  const valid = await comparePassword(String(currentPassword), user.password_hash);
  if (!valid) {
    throw new AppError('Current password is incorrect', 401);
  }

  validatePasswordStrength(String(newPassword));
  const passwordHash = await hashPassword(String(newPassword));
  updateUser(user.id, { password_hash: passwordHash });

  res.json({ success: true });
});

export default router;
