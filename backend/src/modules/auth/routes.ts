// Auth routes: login/logout, token refresh, user management (admin/superadmin),
// comercio management and user password resets (super admin only).

import { Router, Request, Response, NextFunction } from 'express';
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
  validateUsername,
  TokenPayload
} from './auth';
import {
  findUserByUsernameGlobal,
  findUserById,
  listUsers,
  createUser,
  updateUser,
  deleteUser,
  findComercioByName,
  findComercioById,
  createComercio,
  listComercios,
  setComercioActive,
  countUsers,
  recordLoginAttempt,
  isAccountLocked,
  UserRow,
  createRegistrationNonce,
  generateNonceCode,
  findRegistrationNonceByCode,
  findRegistrationNonceById,
  isNonceUsable,
  consumeRegistrationNonce,
  listRegistrationNonces,
  setRegistrationNonceActive
} from './database';
import { requireAuth, requireRole } from './middleware';
import { isSuperAdminConfigured, getSuperAdminConfig, isSuperAdminUsername, verifySuperAdminCredentials } from './super-admin';
import { clearComercioDataStore } from './load-config-middleware';
import type { AIConfig } from '../../types';

// An AI provider counts as configured when a real one is active with the API
// key it needs (the mock provider needs nothing).
export function isAiConfigured(ai?: AIConfig): boolean {
  if (!ai || ai.provider === 'mock') return false;
  const settings = ai.providers?.[ai.provider] ?? {};
  return Boolean(settings.api_key);
}

// Public shape of a user row: password_hash is never sent, and the
// must_change_password flag is exposed as a boolean.
function toPublicUser(user: UserRow) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    comercio_id: user.comercio_id,
    must_change_password: user.must_change_password === 1,
    active: user.active === 1,
    created_at: user.created_at,
    updated_at: user.updated_at
  };
}

function toPublicComercio(c: { id: number; name: string; active: 0 | 1; created_at: string; updated_at: string }) {
  return {
    id: c.id,
    name: c.name,
    active: c.active === 1,
    user_count: countUsers(c.id),
    created_at: c.created_at,
    updated_at: c.updated_at
  };
}

const router = Router();

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;
const wrap = (fn: AsyncHandler) => (req: Request, res: Response, next: NextFunction) => {
  fn(req, res, next).catch(next);
};

// ── Public ───────────────────────────────────────────────────────────────────

// Register a new comercio with its admin user (public, but gated by a
// single-use registration nonce that the super admin hands out).
router.post('/register-comercio', wrap(async (req: Request, res: Response) => {
  const { comercio_name, admin_username, admin_password, nonce } = req.body;

  if (!comercio_name || !admin_username || !admin_password || !nonce) {
    throw new AppError('Comercio name, admin username, admin password and a registration nonce are required', 400);
  }

  const name = String(comercio_name).trim();
  const username = String(admin_username).trim();
  const password = String(admin_password);
  const nonceCode = String(nonce).trim();

  if (name.length < 2 || name.length > 100) {
    throw new AppError('Comercio name must be between 2 and 100 characters', 400);
  }

  if (findComercioByName(name)) {
    throw new AppError('A comercio with this name already exists', 409);
  }

  // The nonce is mandatory: without a valid, unexpired, single-use nonce no new
  // comercio can be created. This lets the super admin gate who can register.
  const nonceRow = findRegistrationNonceByCode(nonceCode);
  if (!nonceRow || !isNonceUsable(nonceRow)) {
    throw new AppError('Invalid, already used or expired registration nonce', 400);
  }

  validateUsername(username);
  validatePasswordStrength(password);

  // Create comercio
  const comercio = createComercio(name);

  // Create admin user. The admin chose this password themselves, so no forced
  // change is required on the first login.
  const passwordHash = await hashPassword(password);
  const user = createUser(username, passwordHash, 'admin', comercio.id, false);

  // The nonce is now spent: it can never be reused.
  consumeRegistrationNonce(nonceRow.id, comercio.id);

  res.status(201).json({
    success: true,
    comercio_id: comercio.id,
    user: toPublicUser(user)
  });
}));

// Login: accepts { username, password } — the comercio is derived from the user.
// A username matching the env-configured ADMIN_USER cannot be used for a
// comercio account: if the ADMIN_* pair is present and the password verifies,
// the session belongs to the super admin (which has no DB row).
router.post('/login', wrap(async (req: Request, res: Response) => {
  const { username, password } = req.body;
  if (!username || !password) {
    throw new AppError('Username and password are required', 400);
  }

  const submittedUsername = String(username);

  if (isAccountLocked(submittedUsername)) {
    throw new AppError('Account is temporarily locked due to too many failed attempts', 429);
  }

  // Super admin path (env-configured account, never stored in the database).
  if (isSuperAdminUsername(submittedUsername)) {
    const valid = await verifySuperAdminCredentials(submittedUsername, String(password));
    if (!valid) {
      recordLoginAttempt(submittedUsername, req.ip, false);
      throw new AppError('Invalid credentials', 401);
    }
    recordLoginAttempt(submittedUsername, req.ip, true);

    const payload: TokenPayload = {
      sub: 0,
      username: submittedUsername,
      role: 'superadmin',
      comercio_id: 0,
      must_change_password: 0
    };
    setAuthCookies(res, signAccessToken(payload), signRefreshToken(payload));

    res.json({
      success: true,
      user: { id: 0, username: submittedUsername, role: 'superadmin', comercio_id: 0, comercio_name: '', must_change_password: false }
    });
    return;
  }

  const user = findUserByUsernameGlobal(submittedUsername);
  if (!user) {
    recordLoginAttempt(submittedUsername, req.ip, false);
    throw new AppError('Invalid credentials', 401);
  }

  const valid = await comparePassword(String(password), user.password_hash);
  if (!valid) {
    recordLoginAttempt(submittedUsername, req.ip, false);
    throw new AppError('Invalid credentials', 401);
  }

  // A disabled user must not be able to log back in.
  if (user.active !== 1) {
    throw new AppError('This account has been disabled by the administrator', 403);
  }

  const comercio = findComercioById(user.comercio_id);
  if (!comercio) {
    throw new AppError('User comercio not found', 500);
  }

  // A disabled comercio must not let its users back in.
  if (comercio.active !== 1) {
    throw new AppError('This comercio has been disabled by the administrator', 403);
  }

  recordLoginAttempt(submittedUsername, req.ip, true);

  // A new session must start clean: any products loaded by a previous session
  // of this comercio are dropped so the dashboard never shows stale data.
  clearComercioDataStore(user.comercio_id);

  const payload: TokenPayload = {
    sub: user.id,
    username: user.username,
    role: user.role,
    comercio_id: user.comercio_id,
    must_change_password: user.must_change_password as 0 | 1
  };
  const accessToken = signAccessToken(payload);
  const refreshToken = signRefreshToken(payload);

  setAuthCookies(res, accessToken, refreshToken);

  res.json({
    success: true,
    user: { id: user.id, username: user.username, role: user.role, comercio_id: user.comercio_id, must_change_password: user.must_change_password === 1, active: user.active === 1 }
  });
}));

router.post('/logout', requireAuth, (req: Request, res: Response) => {
  clearComercioDataStore(req.user!.comercio_id);
  clearAuthCookies(res);
  res.json({ success: true });
});

router.post('/refresh', (req: Request, res: Response) => {
  const token = req.cookies?.refresh_token;
  if (!token) {
    throw new AppError('Refresh token required', 401);
  }
  const decoded = verifyRefreshToken(token);

  // Super admin sessions are re-issued from the environment, not the DB.
  if (decoded.role === 'superadmin') {
    if (!isSuperAdminConfigured() || getSuperAdminConfig().username !== decoded.username) {
      throw new AppError('Super admin no longer configured', 401);
    }
    const payload: TokenPayload = {
      sub: 0,
      username: decoded.username,
      role: 'superadmin',
      comercio_id: 0,
      must_change_password: 0
    };
    setAuthCookies(res, signAccessToken(payload), signRefreshToken(payload));
    res.json({
      success: true,
      user: { id: 0, username: decoded.username, role: 'superadmin', comercio_id: 0, comercio_name: '', must_change_password: false }
    });
    return;
  }

  const user = findUserById(decoded.sub);
  if (!user) {
    throw new AppError('User not found', 401);
  }

  // A user disabled after the session started must not keep refreshing (just
  // like a disabled comercio).
  if (user.active !== 1) {
    throw new AppError('This account has been disabled by the administrator', 401);
  }

  // A comercio disabled after the session started must not keep refreshing.
  const comercio = findComercioById(user.comercio_id);
  if (!comercio || comercio.active !== 1) {
    throw new AppError('This comercio has been disabled by the administrator', 401);
  }

  const payload: TokenPayload = {
    sub: user.id,
    username: user.username,
    role: user.role,
    comercio_id: user.comercio_id,
    must_change_password: user.must_change_password as 0 | 1
  };
  const accessToken = signAccessToken(payload);
  const newRefreshToken = signRefreshToken(payload);

  setAuthCookies(res, accessToken, newRefreshToken);

  res.json({
    success: true,
    user: { id: user.id, username: user.username, role: user.role, comercio_id: user.comercio_id, must_change_password: user.must_change_password === 1, active: user.active === 1 }
  });
});

// ── Current user ─────────────────────────────────────────────────────────────

router.get('/me', requireAuth, (req: Request, res: Response) => {
  if (req.user!.role === 'superadmin') {
    res.json({
      success: true,
      user: { id: 0, username: req.user!.username, role: 'superadmin', comercio_id: 0, comercio_name: '', prestashop_configured: false, ai_configured: false, must_change_password: false }
    });
    return;
  }

  const user = findUserById(req.user!.sub);
  if (!user) {
    throw new AppError('User not found', 404);
  }
  const comercio = findComercioById(user.comercio_id);
  const prestashopConfigured = Boolean(req.store?.config.prestashop.base_url);
  const aiConfigured = isAiConfigured(req.store?.config.ai);
  res.json({
    success: true,
    user: { id: user.id, username: user.username, role: user.role, comercio_id: user.comercio_id, comercio_name: comercio?.name ?? '', prestashop_configured: prestashopConfigured, ai_configured: aiConfigured, must_change_password: user.must_change_password === 1, active: user.active === 1 }
  });
});

// ── User management (admin only, scoped to current comercio) ────────────────

router.get('/users', requireAuth, requireRole('admin'), (req: Request, res: Response) => {
  res.json({ success: true, users: listUsers(req.user!.comercio_id).map(toPublicUser) });
});

router.post('/users', requireAuth, requireRole('admin'), wrap(async (req: Request, res: Response) => {
  const { username, password, role } = req.body;

  validateUsername(String(username));
  validatePasswordStrength(String(password));

  const validRole = role === 'admin' || role === 'user' ? role : 'user';
  const passwordHash = await hashPassword(String(password));

  // The password was chosen by this admin, so the new user must change it on
  // its first login: nobody else should keep knowing the temporary password.
  const user = createUser(String(username), passwordHash, validRole, req.user!.comercio_id, true);

  res.status(201).json({
    success: true,
    user: toPublicUser(user)
  });
}));

router.put('/users/:id', requireAuth, requireRole('admin'), wrap(async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const existing = findUserById(id);
  if (!existing || existing.comercio_id !== req.user!.comercio_id) {
    throw new AppError('User not found', 404);
  }

  // An admin never edits itself here (there is a dedicated /change-password
  // endpoint). Every other user of the comercio — admins included — can be
  // managed (role, password reset via the temporary password, enabled state).
  if (existing.id === req.user!.sub) {
    throw new AppError('Use the "change password" option to change your own password', 400);
  }

  const fields: { password_hash?: string; role?: 'admin' | 'user'; must_change_password?: boolean; active?: boolean } = {};

  if (req.body.password) {
    validatePasswordStrength(String(req.body.password));
    fields.password_hash = await hashPassword(String(req.body.password));
    // The temporary password was handed over by this admin, so the user must
    // change it before doing anything else.
    fields.must_change_password = true;
  }

  if (req.body.role) {
    const validRole = req.body.role === 'admin' || req.body.role === 'user' ? req.body.role : undefined;
    if (validRole) fields.role = validRole;
  }

  if (typeof req.body.active === 'boolean') {
    fields.active = req.body.active;
  }

  updateUser(id, fields);

  const updated = findUserById(id)!;
  res.json({
    success: true,
    user: toPublicUser(updated)
  });
}));

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

router.put('/change-password', requireAuth, wrap(async (req: Request, res: Response) => {
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
  // A successful change clears any "change your password" requirement.
  updateUser(user.id, { password_hash: passwordHash, must_change_password: false });

  res.json({ success: true });
}));

// ── Super admin (env-configured account, cross-comercio) ────────────────────

// Lists every registered comercio with its active state and user count.
router.get('/superadmin/comercios', requireAuth, requireRole('superadmin'), (req: Request, res: Response) => {
  res.json({ success: true, comercios: listComercios().map(toPublicComercio) });
});

// Activates or deactivates a comercio. A deactivated comercio blocks both its
// future logins and the sessions already open.
router.put('/superadmin/comercios/:id/active', requireAuth, requireRole('superadmin'), (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const active = Boolean(req.body.active);
  const comercio = findComercioById(id);
  if (!comercio) {
    throw new AppError('Comercio not found', 404);
  }
  setComercioActive(id, active);
  res.json({ success: true, comercio: { id: comercio.id, name: comercio.name, active, user_count: countUsers(id), created_at: comercio.created_at, updated_at: comercio.updated_at } });
});

// Lists the users of one comercio (the super admin can reset any password there).
router.get('/superadmin/comercios/:id/users', requireAuth, requireRole('superadmin'), (req: Request, res: Response) => {
  const comercioId = Number(req.params.id);
  const comercio = findComercioById(comercioId);
  if (!comercio) {
    throw new AppError('Comercio not found', 404);
  }
  res.json({
    success: true,
    comercio: { id: comercio.id, name: comercio.name, active: comercio.active === 1 },
    users: listUsers(comercioId).map(toPublicUser)
  });
});

// Resets the password of one user of a comercio. The super admin (and only the
// super admin) can reset ANY user here, including admins. The new password is
// temporary: the user must change it on its next login.
router.post('/superadmin/comercios/:id/users/:userId/reset-password', requireAuth, requireRole('superadmin'), wrap(async (req: Request, res: Response) => {
  const comercioId = Number(req.params.id);
  const userId = Number(req.params.userId);
  const user = findUserById(userId);
  if (!user || user.comercio_id !== comercioId) {
    throw new AppError('User not found in this comercio', 404);
  }
  if (!req.body.newPassword) {
    throw new AppError('newPassword is required', 400);
  }

  const newPassword = String(req.body.newPassword);
  validatePasswordStrength(newPassword);
  const passwordHash = await hashPassword(newPassword);
  updateUser(userId, { password_hash: passwordHash, must_change_password: true });

  res.json({ success: true, user: toPublicUser(findUserById(userId)!) });
}));

// Activates or deactivates one user of a comercio. A disabled user cannot log
// in and its open sessions are killed on the next request (requireAuth re-checks
// the active flag). The super admin can toggle any user, admins included.
router.put('/superadmin/comercios/:id/users/:userId/active', requireAuth, requireRole('superadmin'), wrap(async (req: Request, res: Response) => {
  const comercioId = Number(req.params.id);
  const userId = Number(req.params.userId);
  const user = findUserById(userId);
  if (!user || user.comercio_id !== comercioId) {
    throw new AppError('User not found in this comercio', 404);
  }
  if (typeof req.body?.active !== 'boolean') {
    throw new AppError('active (boolean) is required', 400);
  }
  updateUser(userId, { active: req.body.active });

  res.json({ success: true, user: toPublicUser(findUserById(userId)!) });
}));

// ── Registration nonces (super admin) ─────────────────────────────────────────

// Lists every registration nonce the super admin has issued, newest first. The
// code itself is shown (it is what an invitee pastes into the register form);
// used/expired/active state is included so the UI can render badges and actions.
router.get('/superadmin/nonces', requireAuth, requireRole('superadmin'), wrap(async (req: Request, res: Response) => {
  res.json({ success: true, nonces: listRegistrationNonces() });
}));

// Creates a new single-use registration nonce. The super admin picks an expiry
// window; the code is generated server-side so it inherits the non-guessable
// alphabet (no 0/O/1/I/L) and a recognizable batch prefix.
router.post('/superadmin/nonces', requireAuth, requireRole('superadmin'), wrap(async (req: Request, res: Response) => {
  const { duration } = req.body;

  const VALID_DURATIONS = { '12h': 12, '24h': 24, '3d': 72, '7d': 168 } as Record<string, number>;
  const hours = VALID_DURATIONS[String(req.body.duration ?? '7d')];
  if (hours == null) {
    throw new AppError('duration must be one of 12h, 24h, 3d or 7d', 400);
  }

  const code = generateNonceCode();
  const expiresAt = new Date(Date.now() + hours * 3600 * 1000).toISOString();
  const nonce = createRegistrationNonce(code, expiresAt, req.user!.username);

  res.status(201).json({ success: true, nonce });
}));

// Flips a nonce on/off without deleting it. Useful to block a leaked invite
// code immediately or to keep the registration window open while testing.
router.put('/superadmin/nonces/:id/active', requireAuth, requireRole('superadmin'), wrap(async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (typeof req.body?.active !== 'boolean') {
    throw new AppError('active (boolean) is required', 400);
  }
  const updated = setRegistrationNonceActive(id, req.body.active);
  if (!updated) {
    throw new AppError('Registration nonce not found', 404);
  }
  res.json({ success: true, nonce: findRegistrationNonceById(id) });
}));

export default router;
