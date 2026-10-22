// Budget helpers for the calls that may take long.
//
// The autocomplete exchange runs the AI call and the image search in parallel,
// so the answer waits for the slowest of the two. Some image providers answer
// in minutes (their own HTTP timeout goes up to 300s), which used to make the
// whole request time out and threw away the AI proposals that were already
// ready. With these helpers every branch can be given the time it is allowed
// to spend, so one slow branch can never hold the response back.

/**
 * Rejects with a timeout error when the promise does not settle in time. The
 * original promise is NOT cancelled: it keeps running in the background and its
 * result (or error) is simply ignored, because the caller has already moved on.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  // Promise.race attaches a handler to both promises, so a late rejection of the
  // loser is swallowed instead of becoming an unhandled rejection.
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Milliseconds left until the given deadline (absolute epoch). Returns
 * undefined when there is no deadline, and 0 when it has already passed.
 */
export function remainingMs(deadline?: number): number | undefined {
  if (deadline === undefined) return undefined;
  return Math.max(0, deadline - Date.now());
}
