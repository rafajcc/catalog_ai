// Super admin account driven entirely by environment variables. It has no row
// in the database: it exists whenever BOTH ADMIN_USER (plaintext username) and
// ADMIN_PASSWORD (bcrypt hash) are set. If either one is missing or blank, the
// super admin simply cannot log in and its tokens stop working.
//
// ADMIN_PASSWORD must be a bcrypt hash (same algorithm and cost factor the app
// uses for regular users) — the operator hashes the password before putting it
// in the environment. The values are read at call time so tests can set
// process.env freely.

import bcrypt from 'bcryptjs';

export interface SuperAdminConfig {
  username: string;
  passwordHash: string;
}

export function getSuperAdminConfig(): SuperAdminConfig {
  return {
    username: (process.env.ADMIN_USER ?? '').trim(),
    passwordHash: process.env.ADMIN_PASSWORD ?? ''
  };
}

// The super admin is usable only when both variables are present.
export function isSuperAdminConfigured(): boolean {
  const { username, passwordHash } = getSuperAdminConfig();
  return Boolean(username && passwordHash);
}

export function isSuperAdminUsername(username: string): boolean {
  return isSuperAdminConfigured() && username === getSuperAdminConfig().username;
}

export async function verifySuperAdminCredentials(username: string, password: string): Promise<boolean> {
  const { username: expected, passwordHash } = getSuperAdminConfig();
  if (!isSuperAdminConfigured() || username !== expected) return false;
  try {
    return await bcrypt.compare(password, passwordHash);
  } catch {
    // Malformed hash in ADMIN_PASSWORD: never authenticate.
    return false;
  }
}