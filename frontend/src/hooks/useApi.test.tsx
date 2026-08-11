import { act, render, screen, waitFor } from '@testing-library/react';
import { useApi } from './useApi';

function Harness({ action }: { action: (value: number) => Promise<string> }) {
  const { state, run, reset } = useApi<string, [number]>(action);
  return (
    <div>
      <span data-testid="loading">{String(state.loading)}</span>
      <span data-testid="data">{state.data ?? 'none'}</span>
      <span data-testid="error">{state.error ?? 'none'}</span>
      <button onClick={() => run(42)}>run</button>
      <button onClick={reset}>reset</button>
    </div>
  );
}

describe('useApi', () => {
  it('tracks loading, data and error state through the action lifecycle', async () => {
    const action = jest.fn().mockResolvedValue('result');
    render(<Harness action={action} />);

    expect(screen.getByTestId('loading')).toHaveTextContent('false');

    await act(async () => {
      screen.getByText('run').click();
    });

    expect(action).toHaveBeenCalledWith(42);
    expect(screen.getByTestId('data')).toHaveTextContent('result');
    expect(screen.getByTestId('loading')).toHaveTextContent('false');
    expect(screen.getByTestId('error')).toHaveTextContent('none');
  });

  it('records a message when the action rejects', async () => {
    const action = jest.fn().mockRejectedValue(new Error('network down'));
    render(<Harness action={action} />);

    await act(async () => {
      screen.getByText('run').click();
    });

    expect(screen.getByTestId('error')).toHaveTextContent('network down');
    expect(screen.getByTestId('data')).toHaveTextContent('none');
  });

  it('resets state back to its initial values', async () => {
    const action = jest.fn().mockResolvedValue('result');
    render(<Harness action={action} />);

    await act(async () => {
      screen.getByText('run').click();
    });
    expect(screen.getByTestId('data')).toHaveTextContent('result');

    await act(async () => {
      screen.getByText('reset').click();
    });

    expect(screen.getByTestId('data')).toHaveTextContent('none');
    expect(screen.getByTestId('error')).toHaveTextContent('none');
  });

  it('ignores concurrent runs while one is in flight', async () => {
    let resolveAction: (value: string) => void;
    const action = jest.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveAction = resolve;
        })
    );
    render(<Harness action={action} />);

    let firstRun: Promise<[void, void]>;
    await act(async () => {
      firstRun = Promise.all([screen.getByText('run').click(), screen.getByText('run').click()]);
    });
    await act(async () => {
      resolveAction!('done');
      await firstRun;
    });

    expect(action).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('data')).toHaveTextContent('done');
  });

  it('renders fine with an async action', async () => {
    const action = jest.fn(async (v: number) => `value-${v}`);
    render(<Harness action={action} />);

    await waitFor(() => {
      expect(screen.getByTestId('data')).toHaveTextContent('none');
    });
  });
});
