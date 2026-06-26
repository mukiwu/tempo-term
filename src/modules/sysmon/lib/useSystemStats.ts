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
    const poll = () => {
      fetchSystemStats()
        .then((next) => {
          if (active) {
            setStats(next);
          }
        })
        .catch(() => {
          // A failed poll just leaves the previous value on screen.
        });
    };
    poll();
    const id = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  return stats;
}
