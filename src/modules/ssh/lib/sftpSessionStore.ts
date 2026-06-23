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
        set((s) => {
          const pending = { ...s.pending };
          delete pending[connectionId];
          return { sessions: { ...s.sessions, [connectionId]: id }, pending };
        });
        return id;
      })
      .catch((err: unknown) => {
        set((s) => {
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
      return { sessions };
    });
  },

  closeAll: () => {
    for (const id of Object.values(get().sessions)) {
      void sftpClose(id).catch(() => {});
    }
    set({ sessions: {}, pending: {} });
  },
}));
