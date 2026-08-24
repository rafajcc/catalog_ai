import { act, render, screen } from '@testing-library/react';
import { useBackendStatus } from './useBackendStatus';

function Harness({ api }: { api: any }) {
  const status = useBackendStatus(api);
  return <span data-testid="status">{status}</span>;
}

function makeApi(getSystemStatus: () => Promise<any>) {
  return { getSystemStatus: vi.fn(getSystemStatus) };
}

describe('useBackendStatus', () => {
  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  });

  it('reports Checking initially and Online after a successful check', async () => {
    vi.useFakeTimers();
    const api = makeApi(() => Promise.resolve({ success: true, message: 'Online' }));
    render(<Harness api={api} />);

    expect(screen.getByTestId('status')).toHaveTextContent('Checking…');

    await act(async () => {
      vi.advanceTimersByTime(0);
    });

    expect(screen.getByTestId('status')).toHaveTextContent('Online');
    expect(api.getSystemStatus).toHaveBeenCalledTimes(1);
  });

  it('reports Offline when the status check fails', async () => {
    vi.useFakeTimers();
    const api = makeApi(() => Promise.reject(new Error('down')));
    render(<Harness api={api} />);

    await act(async () => {
      vi.advanceTimersByTime(0);
    });

    expect(screen.getByTestId('status')).toHaveTextContent('Offline');
  });

  it('reports Degraded when the backend responds unsuccessfully', async () => {
    vi.useFakeTimers();
    const api = makeApi(() => Promise.resolve({ success: false, message: 'degraded' }));
    render(<Harness api={api} />);

    await act(async () => {
      vi.advanceTimersByTime(0);
    });

    expect(screen.getByTestId('status')).toHaveTextContent('Degraded');
  });

  it('recovers to Online on a later poll once the backend returns', async () => {
    vi.useFakeTimers();
    const api = makeApi(() => Promise.reject(new Error('down')));
    render(<Harness api={api} />);

    await act(async () => {
      vi.advanceTimersByTime(0);
    });
    expect(screen.getByTestId('status')).toHaveTextContent('Offline');

    api.getSystemStatus.mockImplementation(() => Promise.resolve({ success: true, message: 'Online' }));

    await act(async () => {
      vi.advanceTimersByTime(5000);
    });

    expect(api.getSystemStatus).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('status')).toHaveTextContent('Online');
  });

  it('polls every 5s while offline', async () => {
    vi.useFakeTimers();
    const api = makeApi(() => Promise.reject(new Error('down')));
    render(<Harness api={api} />);

    await act(async () => {
      vi.advanceTimersByTime(0);
    });

    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(api.getSystemStatus).toHaveBeenCalledTimes(2);

    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(api.getSystemStatus).toHaveBeenCalledTimes(3);
  });

  it('polls every 30s while online', async () => {
    vi.useFakeTimers();
    const api = makeApi(() => Promise.resolve({ success: true, message: 'Online' }));
    render(<Harness api={api} />);

    await act(async () => {
      vi.advanceTimersByTime(0);
    });
    expect(api.getSystemStatus).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(30000);
    });

    expect(api.getSystemStatus).toHaveBeenCalledTimes(2);
  });

  it('does not schedule overlapping polls while one is in flight', async () => {
    vi.useFakeTimers();
    let resolveCheck: (value: any) => void;
    const api = makeApi(
      () =>
        new Promise<any>((resolve) => {
          resolveCheck = resolve;
        })
    );
    render(<Harness api={api} />);

    await act(async () => {
      vi.advanceTimersByTime(0);
    });
    expect(api.getSystemStatus).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(10000);
    });
    expect(api.getSystemStatus).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveCheck!({ success: true, message: 'Online' });
    });
    expect(screen.getByTestId('status')).toHaveTextContent('Online');
  });

  it('uses a slow heartbeat while the tab is hidden', async () => {
    vi.useFakeTimers();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    const api = makeApi(() => Promise.resolve({ success: true, message: 'Online' }));
    render(<Harness api={api} />);

    await act(async () => {
      vi.advanceTimersByTime(0);
    });
    expect(api.getSystemStatus).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(30000);
    });
    expect(api.getSystemStatus).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(30000);
    });
    expect(api.getSystemStatus).toHaveBeenCalledTimes(2);
  });
});
