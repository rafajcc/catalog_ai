// API key generation and hashing.
//
// The plaintext secret is shown to the super admin exactly once, when the key is
// created, and is never persisted: the database only stores its SHA-256 hash.
// Because a key is a high-entropy random string (not a low-entropy password),
// a fast hash is enough — bcrypt would only add cost to every authenticated
// request without meaningfully improving resistance to brute force.

import crypto from 'crypto';

// Human-recognisable prefix of every generated key, so a leaked secret can be
// told apart from other tokens at a glance.
const KEY_PREFIX = 'ck_live_';

// How many leading characters of the plaintext we keep to identify a key in a
// listing (the prefix constant plus a few random chars).
const DISPLAY_PREFIX_LENGTH = KEY_PREFIX.length + 6;

// A fresh secret. 32 random bytes (256 bits) encoded base64url keep the key URL-
// and header-safe (no '+', '/', '='), so it can travel in an Authorization
// header without escaping.
export function generateApiKey(): string {
  return `${KEY_PREFIX}${crypto.randomBytes(32).toString('base64url')}`;
}

// The identifying prefix of a key (never a secret on its own: it is only the
// first characters, too short to authenticate with).
export function apiKeyPrefix(key: string): string {
  return key.slice(0, DISPLAY_PREFIX_LENGTH);
}

// The stored form of a key. Deterministic, so lookup is a direct index hit.
export function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key, 'utf8').digest('hex');
}
