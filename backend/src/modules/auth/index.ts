export { initDatabase, persist, findUserByUsername, findUserByUsernameGlobal, findUserById, listUsers, createUser, updateUser, deleteUser, recordLoginAttempt, isAccountLocked, createComercio, findComercioByName, findComercioById } from './database';
export { hashPassword, comparePassword, validatePasswordStrength, validateUsername, signAccessToken, signRefreshToken, verifyAccessToken, verifyRefreshToken, setAuthCookies, clearAuthCookies } from './auth';
export type { TokenPayload } from './auth';
export { requireAuth, requireRole } from './middleware';
export { default as authRoutes } from './routes';
