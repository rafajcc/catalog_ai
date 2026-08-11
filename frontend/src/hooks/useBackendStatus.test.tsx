import { act, render, screen } from '@testing-library/react';
import { useBackendStatus } from './useBackendStatus';

function Harness({ api }: { api: any }) {
  const status = useBackendStatus(api);
  return <span data-testid="status">{status}</span>;
}

function makeApi(getSystemStatus: () => Promise<any>) {
  return { getSystemStatus: jest.fn(getSystemStatus) };
}

describe('useBackendStatus', () => {
  afterEach(() => {
    jest.useRealTimers();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  });

  it('reports Checking initially and Online after a successful check', async () => {
    jest.useFakeTimers();
    const api = makeApi(() => Promise.resolve({ success: true, message: 'Online' }));
    render(<Harness api={api} />);

    expect(screen.getByTestId('status')).toHaveTextContent('Checking…');

    await act(async () => {
      jest.advanceTimersByTime(0);
    });

    expect(screen.getByTestId('status')).toHaveTextContent('Online');
    expect(api.getSystemStatus).toHaveBeenCalledTimes(1);
  });

  it('reports Offline when the status check fails', async () => {
    jest.useFakeTimers();
    const api = makeApi(() => Promise.reject(new Error('down')));
    render(<Harness api={api} />);

    await act(async () => {
      jest.advanceTimersByTime(0);
    });

    expect(screen.getByTestId('status')).toHaveTextContent('Offline');
  });

  it('reports Degraded when the backend responds unsuccessfully', async () => {
    jest.useFakeTimers();
    const api = makeApi(() => Promise.resolve({ success: false, message: 'degraded' }));
    render(<Harness api={api} />);

    await act(async () => {
      jest.advanceTimersByTime(0);
    });

    expect(screen.getByTestId('status')).toHaveTextContent('Degraded');
  });

  it('recovers to Online on a later poll once the backend returns', async () => {
    jest.useFakeTimers();
    const api = makeApi(() => Promise.reject(new Error('down')));
    render(<Harness api={api} />);

    await act(async () => {
      jest.advanceTimersByTime(0);
    });
    expect(screen.getByTestId('status')).toHaveTextContent('Offline');

    api.getSystemStatus.mockImplementation(() => Promise.resolve({ success: true, message: 'Online' }));

    await act(async () => {
      jest.advanceTimersByTime(5000);
    });

    expect(api.getSystemStatus).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('status')).toHaveTextContent('Online');
  });

  it('polls every 5s while offline', async () => {
    jest.useFakeTimers();
    const api = makeApi(() => Promise.reject(new Error('down')));
    render(<Harness api={api} />);

    await act(async () => {
      jest.advanceTimersByTime(0);
    });

    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    expect(api.getSystemStatus).toHaveBeenCalledTimes(2);

    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    expect(api.getSystemStatus).toHaveBeenCalledTimes(3);
  });

  it('polls every 30s while online', async () => {
    jest.useFakeTimers();
    const api = makeApi(() => Promise.resolve({ success: true, message: 'Online' }));
    render(<Harness api={api} />);

    await act(async () => {
      jest.advanceTimersByTime(0);
    });
    expect(api.getSystemStatus).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(30000);
    });

    expect(api.getSystemStatus).toHaveBeenCalledTimes(2);
  });

  it('does not schedule overlapping polls while one is in flight', async () => {
    jest.useFakeTimers();
    let resolveCheck: (value: any) => void;
    const api = makeApi(
      () =>
        new Promise<any>((resolve) => {
          resolveCheck = resolve;
        })
    );
    render(<Harness api={api} />);

    await act(async () => {
      jest.advanceTimersByTime(0);
    });
    expect(api.getSystemStatus).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(10000);
    });
    expect(api.getSystemStatus).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveCheck!({ success: true, message: 'Online' });
    });
    expect(screen.getByTestId('status')).toHaveTextContent('Online');
  });

  it('uses a slow heartbeat while the tab is hidden', async () => {
    jest.useFakeTimers();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    const api = makeApi(() => Promise.resolve({ success: true, message: 'Online' }));
    render(<Harness api={api} />);

    await act(async () => {
      jest.advanceTimersByTime(0);
    });
    expect(api.getSystemStatus).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(30000);
    });
    expect(api.getSystemStatus).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(30000);
    });
    expect(api.getSystemStatus).toHaveBeenCalledTimes(2);
  });
});
