import { useEffect, useState } from "react";
import { fetchSystemStats, type SystemStats } from "./sysinfoBridge";

/** How often the status bar refreshes the system metrics. */
const POLL_INTERVAL_MS = 2000;

/**
 * Poll the backend for system metrics on a fixed interval. Returns the latest
 * snapshot, or null until the first one arrives. The interval is cleared on
 * unmount and a stale in-flight result is dropped after unmount.
 */
export function useSystemStats(): SystemStats | null {
  const [stats, setStats] = useState<SystemStats | null>(null);

  useEffect(() => {
    let active = true;
    // Guard against out-of-order responses: if a slow poll resolves after a
    // newer one, drop it so the latest sample always wins.
    let nextId = 0;
    let lastApplied = 0;
    const poll = () => {
      const id = ++nextId;
      fetchSystemStats()
        .then((next) => {
          if (active && id > lastApplied) {
            lastApplied = id;
            setStats(next);
          }
        })
        .catch(() => {
          // A failed poll just leaves the previous value on screen.
        });
    };
    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  return stats;
}
