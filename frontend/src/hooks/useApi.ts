import { useCallback, useRef, useState } from 'react';

export interface AsyncState<T> {
  data: T | undefined;
  loading: boolean;
  error: string | undefined;
}

export interface UseApiResult<T, A extends unknown[]> {
  state: AsyncState<T>;
  run: (...args: A) => Promise<T | undefined>;
  reset: () => void;
}

/**
 * Wraps an async operation with loading/error state.
 * A new run() while one is in flight is ignored until the current one settles.
 */
export function useApi<T, A extends unknown[]>(action: (...args: A) => Promise<T>): UseApiResult<T, A> {
  const [state, setState] = useState<AsyncState<T>>({ data: undefined, loading: false, error: undefined });
  const inFlight = useRef(false);

  const run = useCallback(
    async (...args: A): Promise<T | undefined> => {
      if (inFlight.current) {
        return undefined;
      }
      inFlight.current = true;
      setState((prev) => ({ ...prev, loading: true, error: undefined }));
      try {
        const data = await action(...args);
        setState({ data, loading: false, error: undefined });
        return data;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Request failed';
        setState((prev) => ({ ...prev, loading: false, error: message }));
        return undefined;
      } finally {
        inFlight.current = false;
      }
    },
    [action]
  );

  const reset = useCallback(() => {
    setState({ data: undefined, loading: false, error: undefined });
  }, []);

  return { state, run, reset };
}
