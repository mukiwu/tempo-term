import { useEffect, useState } from "react";
import { remoteCwdStore } from "./remoteCwdStore";
import { useConnectionsStore } from "@/stores/connectionsStore";

export const OSC7_HINT_TIMEOUT_MS = 10_000;

/** Connections already hinted this session, so pane re-activation never re-nags
 *  someone who closed the dialog without ticking the permanent dismiss. */
let shownThisSession = new Set<string>();

/** Test-only: forget which connections were hinted. */
export function resetShownThisSession(): void {
  shownThisSession = new Set();
}

/**
 * One-time guidance when a remote shell never announces its cwd: after an SSH
 * pane has been the active explorer driver for OSC7_HINT_TIMEOUT_MS with no
 * OSC 7 report, surface a hint pointing at the connection form's setup snippet.
 * A report cancels the timer; a per-connection `osc7HintDismissed` flag mutes
 * it forever.
 */
export function useOsc7FallbackHint(activeSshConnectionId: string | null): {
  hintConnectionId: string | null;
  dismissHint: () => void;
} {
  const [hintConnectionId, setHintConnectionId] = useState<string | null>(null);

  useEffect(() => {
    const id = activeSshConnectionId;
    if (!id || shownThisSession.has(id)) {
      return;
    }
    if (useConnectionsStore.getState().getConnection(id)?.osc7HintDismissed) {
      return;
    }
    if (remoteCwdStore.getState().cwds[id]) {
      return;
    }
    const timer = setTimeout(() => {
      shownThisSession.add(id);
      setHintConnectionId(id);
    }, OSC7_HINT_TIMEOUT_MS);
    const unsubscribe = remoteCwdStore.subscribe((state) => {
      if (state.cwds[id]) {
        clearTimeout(timer);
        unsubscribe();
      }
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [activeSshConnectionId]);

  const dismissHint = () => {
    if (hintConnectionId) {
      useConnectionsStore
        .getState()
        .updateConnection(hintConnectionId, { osc7HintDismissed: true });
    }
    setHintConnectionId(null);
  };

  return { hintConnectionId, dismissHint };
}
