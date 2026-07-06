import { useEffect } from "react";
import { sftpSessionStore } from "./sftpSessionStore";
import { sftpHome } from "./sftp-bridge";
import { buildRemoteUri } from "./remotePath";
import { remoteCwdStore } from "./remoteCwdStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";

/**
 * When the active pane is an SSH terminal, point the file explorer at that
 * host's remote home over SFTP. A null id (local pane active) is a no-op, so the
 * existing local cwd tracking keeps driving the root.
 */
export function useRemoteExplorerRoot(activeSshConnectionId: string | null): void {
  useEffect(() => {
    if (!activeSshConnectionId) {
      return;
    }
    // The shell's own report is fresher than the SFTP home — prefer it, and
    // skip the connect round-trip entirely (fsReadDir ensures a session later).
    const known = remoteCwdStore.getState().cwds[activeSshConnectionId];
    if (known) {
      useWorkspaceStore.getState().setRoot(buildRemoteUri(activeSshConnectionId, known));
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const id = await sftpSessionStore.getState().ensure(activeSshConnectionId);
        const home = await sftpHome(id);
        if (cancelled) {
          return;
        }
        // An OSC 7 report that arrived while home was in flight wins.
        if (remoteCwdStore.getState().cwds[activeSshConnectionId]) {
          return;
        }
        useWorkspaceStore.getState().setRoot(buildRemoteUri(activeSshConnectionId, home));
      } catch {
        // Connect/auth failed; the explorer shows its empty/error state.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeSshConnectionId]);
}
