import { useEffect, useState } from "react";
import { fetchPorts, type PortInfo } from "./portsBridge";

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
    poll();
    const interval = setInterval(poll, intervalMs);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [showAll, intervalMs]);

  return ports;
}
