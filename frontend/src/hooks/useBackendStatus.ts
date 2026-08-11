import { useEffect, useState } from 'react';
import { ApiService, getApiService } from '../services/api-service';

export type BackendStatus = 'Online' | 'Offline' | 'Degraded' | 'Checking…';

const ONLINE_INTERVAL_MS = 30000;
const OFFLINE_INTERVAL_MS = 5000;
const HIDDEN_INTERVAL_MS = 60000;

function heartbeatInterval(next: BackendStatus): number {
  if (document.visibilityState !== 'visible') {
    return HIDDEN_INTERVAL_MS;
  }
  return next === 'Offline' ? OFFLINE_INTERVAL_MS : ONLINE_INTERVAL_MS;
}

export function useBackendStatus(api: ApiService = getApiService()): BackendStatus {
  const [status, setStatus] = useState<BackendStatus>('Checking…');

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    let timer: ReturnType<typeof setTimeout>;

    async function check(): Promise<void> {
      if (inFlight) return;
      inFlight = true;

      let next: BackendStatus;
      try {
        const result = await api.getSystemStatus();
        next = result.success ? ((result.message ?? 'Online') as BackendStatus) : 'Degraded';
      } catch {
        next = 'Offline';
      }

      inFlight = false;
      if (cancelled) return;

      setStatus(next);
      timer = setTimeout(check, heartbeatInterval(next));
    }

    timer = setTimeout(check, 0);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [api]);

  return status;
}
