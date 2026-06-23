import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { SshAuthMethod } from "@/modules/ssh/lib/parseSshCommand";

export interface SshConnection {
  id: string;
  name: string;
  host: string;
  port: number;
  user: string;
  authMethod: SshAuthMethod;
  keyPath?: string;
  rememberSecret: boolean;
}

interface ConnectionsState {
  connections: SshConnection[];
  addConnection: (input: Omit<SshConnection, "id">) => string;
  updateConnection: (id: string, patch: Partial<Omit<SshConnection, "id">>) => void;
  removeConnection: (id: string) => void;
  getConnection: (id: string) => SshConnection | undefined;
}

const STORAGE_KEY = "tempoterm-connections";

export const useConnectionsStore = create<ConnectionsState>()(
  persist(
    (set, get) => ({
      connections: [],
      addConnection: (input) => {
        const id = crypto.randomUUID();
        set((s) => ({ connections: [...s.connections, { ...input, id }] }));
        return id;
      },
      updateConnection: (id, patch) =>
        set((s) => ({
          connections: s.connections.map((c) =>
            c.id === id ? { ...c, ...patch, id } : c,
          ),
        })),
      removeConnection: (id) =>
        set((s) => ({ connections: s.connections.filter((c) => c.id !== id) })),
      getConnection: (id) => get().connections.find((c) => c.id === id),
    }),
    { name: STORAGE_KEY },
  ),
);
