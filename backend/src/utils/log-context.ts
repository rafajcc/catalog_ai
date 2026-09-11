// Request-scoped logging context. AsyncLocalStorage attaches the comercio
// (tenant) and user that own the current request, and every log line emitted
// while handling it is prefixed with that context — so concurrent requests
// from different shops never mix in the logs.

import { AsyncLocalStorage } from 'async_hooks';

export interface LogContext {
  // Numeric id of the comercio (tenant) the request belongs to, e.g. 2.
  comercioId?: number;
  // Numeric id of the authenticated user (JWT `sub`), e.g. 7.
  userId?: number;
  // Username of the authenticated user, for readability.
  username?: string;
}

const storage = new AsyncLocalStorage<LogContext>();

// Runs `fn` with the given context; the context propagates automatically to
// every log call that happens inside, including through awaited promises.
export function withLogContext<T>(context: LogContext, fn: () => T): T {
  return storage.run(context, fn);
}

// Returns the context of the current request, or an empty object when none
// (e.g. startup logs or requests that have not gone through auth yet).
export function getLogContext(): LogContext {
  return storage.getStore() ?? {};
}