import { render, screen, act } from '@testing-library/react';
import OfflineBanner from '@/components/ui/OfflineBanner';

/**
 * Integration tests for the offline banner: the real OfflineBanner, useOffline
 * hook and networkService are exercised together. Only the browser boundary
 * (navigator.onLine and fetch) is stubbed.
 */

const setNavigatorOnline = (value: boolean) => {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    value,
  });
};

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

const goOffline = async () => {
  setNavigatorOnline(false);
  await act(async () => {
    window.dispatchEvent(new Event('offline'));
    await flush();
  });
};

const goOnline = async () => {
  setNavigatorOnline(true);
  await act(async () => {
    window.dispatchEvent(new Event('online'));
    await flush();
  });
};

describe('OfflineBanner behavior and reconnect logic', () => {
  const fetchMock = jest.fn();
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.useFakeTimers();
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
    setNavigatorOnline(true);
  });

  afterEach(() => {
    jest.useRealTimers();
    global.fetch = originalFetch;
    setNavigatorOnline(true);
  });

  it('renders nothing when the browser starts online', () => {
    const { container } = render(<OfflineBanner />);

    expect(container).toBeEmptyDOMElement();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows the offline banner immediately when the browser starts offline', () => {
    setNavigatorOnline(false);

    render(<OfflineBanner />);

    expect(screen.getByRole('status')).toHaveTextContent(
      /you are currently offline/i
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      /transactions are disabled/i
    );
  });

  it('shows the banner on an offline event without hitting the network', async () => {
    render(<OfflineBanner />);

    await goOffline();

    expect(screen.getByRole('status')).toHaveTextContent(/currently offline/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('verifies reconnect via the heartbeat endpoint, then shows and dismisses "Back Online!"', async () => {
    fetchMock.mockResolvedValue({ ok: true });
    render(<OfflineBanner />);

    await goOffline();
    await goOnline();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/system/heartbeat',
      expect.objectContaining({ method: 'GET', cache: 'no-store' })
    );
    expect(screen.getByRole('status')).toHaveTextContent(/back online!/i);
    expect(screen.queryByText(/currently offline/i)).not.toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(1999);
    });
    expect(screen.getByRole('status')).toHaveTextContent(/back online!/i);

    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('stays offline when the interface returns but the heartbeat is not ok', async () => {
    fetchMock.mockResolvedValue({ ok: false });
    render(<OfflineBanner />);

    await goOffline();
    await goOnline();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent(/currently offline/i);
    expect(screen.queryByText(/back online/i)).not.toBeInTheDocument();
  });

  it('stays offline when the heartbeat request rejects', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    render(<OfflineBanner />);

    await goOffline();
    await goOnline();

    expect(screen.getByRole('status')).toHaveTextContent(/currently offline/i);
  });

  it('recovers on a later online event after a failed reconnect attempt', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true });
    render(<OfflineBanner />);

    await goOffline();
    await goOnline();
    expect(screen.getByRole('status')).toHaveTextContent(/currently offline/i);

    await goOnline();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('status')).toHaveTextContent(/back online!/i);
  });

  it('does not let a stale reconnect result override a newer offline event (flapping)', async () => {
    let resolveHeartbeat: (value: { ok: boolean }) => void = () => {};
    fetchMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveHeartbeat = resolve;
        })
    );
    render(<OfflineBanner />);

    await goOffline();
    await goOnline(); // heartbeat now pending
    await goOffline(); // supersedes the pending verification

    await act(async () => {
      resolveHeartbeat({ ok: true }); // stale success arrives late
      await flush();
    });

    expect(screen.getByRole('status')).toHaveTextContent(/currently offline/i);
    expect(screen.queryByText(/back online/i)).not.toBeInTheDocument();
  });

  it('aborts the in-flight heartbeat when the connection drops again', async () => {
    let capturedSignal: AbortSignal | undefined;
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
      capturedSignal = init?.signal ?? undefined;
      return new Promise(() => {});
    });
    render(<OfflineBanner />);

    await goOffline();
    await goOnline();
    expect(capturedSignal?.aborted).toBe(false);

    await goOffline();

    expect(capturedSignal?.aborted).toBe(true);
  });

  it('cancels the "Back Online!" timer and a new offline event wins during the success flash', async () => {
    fetchMock.mockResolvedValue({ ok: true });
    render(<OfflineBanner />);

    await goOffline();
    await goOnline();
    expect(screen.getByRole('status')).toHaveTextContent(/back online!/i);

    await goOffline();

    expect(screen.getByRole('status')).toHaveTextContent(/currently offline/i);
    act(() => {
      jest.advanceTimersByTime(5000);
    });
    expect(screen.getByRole('status')).toHaveTextContent(/currently offline/i);
  });

  it('removes its listeners and ignores events after unmount', async () => {
    fetchMock.mockResolvedValue({ ok: true });
    const { unmount } = render(<OfflineBanner />);

    unmount();
    await act(async () => {
      window.dispatchEvent(new Event('online'));
      await flush();
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('exposes the banner as a polite live region for assistive technology', async () => {
    render(<OfflineBanner />);

    await goOffline();

    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
  });
});
