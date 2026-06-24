import { create } from "zustand";
import { sftpClose, sftpStart } from "./sftp-bridge";
import { useConnectionsStore } from "@/stores/connectionsStore";

interface SftpSessionState {
  /** connectionId -> live sftp session id */
  sessions: Record<string, number>;
  /** connectionId -> in-flight open, so concurrent callers share one connect */
  pending: Record<string, Promise<number>>;
  ensure: (connectionId: string) => Promise<number>;
  closeFor: (connectionId: string) => void;
  closeAll: () => void;
}

export const sftpSessionStore = create<SftpSessionState>()((set, get) => ({
  sessions: {},
  pending: {},

  ensure: (connectionId) => {
    const existing = get().sessions[connectionId];
    if (existing !== undefined) {
      return Promise.resolve(existing);
    }
    const inflight = get().pending[connectionId];
    if (inflight) {
      return inflight;
    }
    const conn = useConnectionsStore.getState().getConnection(connectionId);
    if (!conn) {
      return Promise.reject(new Error(`unknown connection ${connectionId}`));
    }
    const open = sftpStart({
      connectionId: conn.id,
      host: conn.host,
      port: conn.port,
      user: conn.user,
      authMethod: conn.authMethod,
      keyPath: conn.keyPath,
    })
      .then((id) => {
        let dropped = false;
        set((s) => {
          // Only keep this session if our open is still the tracked one.
          // closeAll/closeFor clears the entry, and a re-open replaces it with a
          // newer promise; in both cases this result is stale and must be closed
          // rather than added, or it leaks a background connection.
          if (s.pending[connectionId] !== open) {
            dropped = true;
            return {};
          }
          const pending = { ...s.pending };
          delete pending[connectionId];
          return { sessions: { ...s.sessions, [connectionId]: id }, pending };
        });
        if (dropped) {
          void sftpClose(id).catch(() => {});
        }
        return id;
      })
      .catch((err: unknown) => {
        set((s) => {
          // Don't clear a newer pending open that superseded this failed one.
          if (s.pending[connectionId] !== open) {
            return {};
          }
          const pending = { ...s.pending };
          delete pending[connectionId];
          return { pending };
        });
        throw err;
      });
    set((s) => ({ pending: { ...s.pending, [connectionId]: open } }));
    return open;
  },

  closeFor: (connectionId) => {
    const id = get().sessions[connectionId];
    if (id !== undefined) {
      void sftpClose(id).catch(() => {});
    }
    set((s) => {
      const sessions = { ...s.sessions };
      delete sessions[connectionId];
      const pending = { ...s.pending };
      delete pending[connectionId];
      return { sessions, pending };
    });
  },

  closeAll: () => {
    for (const id of Object.values(get().sessions)) {
      void sftpClose(id).catch(() => {});
    }
    set({ sessions: {}, pending: {} });
  },
}));
