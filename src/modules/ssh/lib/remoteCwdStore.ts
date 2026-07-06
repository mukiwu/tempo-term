import { create } from "zustand";

/**
 * Last OSC 7-reported working directory per SSH connection. Written by the
 * terminal's OSC 7 handler on every report (active pane or not); read by
 * useRemoteExplorerRoot (prefer the shell's cwd over the SFTP home) and by the
 * OSC 7 fallback hint (a present entry means the remote shell emits OSC 7).
 */
interface RemoteCwdState {
  cwds: Record<string, string>;
  report: (connectionId: string, path: string) => void;
}

export const remoteCwdStore = create<RemoteCwdState>()((set) => ({
  cwds: {},
  report: (connectionId, path) =>
    set((s) => ({ cwds: { ...s.cwds, [connectionId]: path } })),
}));
