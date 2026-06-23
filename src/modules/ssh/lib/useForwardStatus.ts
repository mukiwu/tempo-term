import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useForwardStatusStore, type ForwardStatus } from "./forwardStatusStore";

/**
 * Mounts once in App and feeds every `ssh-forward-status` event emitted by
 * the backend into the forwardStatusStore. Uses the active-flag pattern so
 * that if the component unmounts before `listen()` resolves we detach the
 * listener immediately instead of leaking it.
 */
export function useForwardStatusListener(): void {
  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;

    listen<ForwardStatus>("ssh-forward-status", (e) => {
      if (active) useForwardStatusStore.getState().applyStatus(e.payload);
    })
      .then((off) => {
        if (active) {
          unlisten = off;
        } else {
          off();
        }
      })
      .catch(() => {
        // No Tauri runtime in tests / web preview — swallow silently.
      });

    return () => {
      active = false;
      unlisten?.();
    };
  }, []);
}
