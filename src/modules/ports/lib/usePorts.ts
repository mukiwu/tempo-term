import { useEffect, useState } from "react";
import { fetchPorts, type PortInfo } from "./portsBridge";

/** How often the port list refreshes; ports change less often than cpu/ram. */
const POLL_INTERVAL_MS = 5000;

/**
 * Poll the backend for listening ports on a fixed interval. Returns the latest
 * list, or null until the first arrives. Re-subscribes when `showAll` changes.
 * Drops out-of-order responses and clears the interval on unmount.
 */
export function usePorts(showAll: boolean): PortInfo[] | null {
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
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [showAll]);

  return ports;
}
