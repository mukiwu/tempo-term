import { useCallback, useEffect, useRef, useState } from "react";
import { fetchPorts, type PortInfo } from "./portsBridge";
import { useWindowVisible } from "@/lib/windowActivity";

/** Default cadence; callers poll slower while the panel is closed. */
const DEFAULT_POLL_INTERVAL_MS = 5000;

/**
 * Poll the backend for listening ports on a fixed interval. Returns the latest
 * list, or null until the first arrives. Re-subscribes when `showAll` or
 * `intervalMs` changes. Drops out-of-order responses and clears the interval on
 * unmount. Callers raise `intervalMs` when nothing is watching to cut idle work.
 */
export function usePorts(showAll: boolean, intervalMs: number = DEFAULT_POLL_INTERVAL_MS): PortInfo[] | null {
  const [ports, setPorts] = useState<PortInfo[] | null>(null);
  const windowVisible = useWindowVisible();

  useEffect(() => {
    let active = true;
    let nextId = 0;
    let lastApplied = 0;
    const poll = () => {
      const id = ++nextId;
      fetchPorts(showAll)
        .then((next) => {
          if (active && id > lastApplied) {
            lastApplied = id;
            setPorts(next);
          }
        })
        .catch(() => {
          // A failed poll leaves the previous list on screen.
        });
    };
    if (!windowVisible) return;
    poll();
    const interval = setInterval(poll, intervalMs);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [showAll, intervalMs, windowVisible]);

  return ports;
}

export interface PortMonitorState {
  ports: PortInfo[] | null;
  error: string | null;
  lastUpdatedAt: number | null;
  refreshing: boolean;
  refresh: () => Promise<void>;
}

/**
 * Interactive variant used by the open panel. Automatic requests stop while
 * paused, while an explicit refresh can still replace the current snapshot.
 * A response that was already in flight when Pause was clicked is discarded.
 */
export function usePortMonitor(
  showAll: boolean,
  autoRefresh: boolean,
  intervalMs: number = DEFAULT_POLL_INTERVAL_MS,
): PortMonitorState {
  const [ports, setPorts] = useState<PortInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const windowVisible = useWindowVisible();
  const mountedRef = useRef(true);
  const autoRefreshRef = useRef(autoRefresh);
  const requestIdRef = useRef(0);

  autoRefreshRef.current = autoRefresh;

  useEffect(() => {
    // React Strict Mode replays effects in development; reset this during each
    // setup so the second mount pass can still accept responses.
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const runRefresh = useCallback(async (manual: boolean) => {
    const requestId = ++requestIdRef.current;
    setRefreshing(true);
    try {
      const next = await fetchPorts(showAll);
      if (
        mountedRef.current &&
        requestId === requestIdRef.current &&
        (manual || autoRefreshRef.current)
      ) {
        setPorts(next);
        setError(null);
        setLastUpdatedAt(Date.now());
      }
    } catch (err: unknown) {
      if (mountedRef.current && requestId === requestIdRef.current) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (mountedRef.current && requestId === requestIdRef.current) {
        setRefreshing(false);
      }
    }
  }, [showAll]);

  const refresh = useCallback(() => runRefresh(true), [runRefresh]);

  useEffect(() => {
    if (!windowVisible || !autoRefresh) return;
    void runRefresh(false);
    const interval = setInterval(() => void runRefresh(false), intervalMs);
    return () => clearInterval(interval);
  }, [autoRefresh, intervalMs, runRefresh, windowVisible]);

  return { ports, error, lastUpdatedAt, refreshing, refresh };
}
