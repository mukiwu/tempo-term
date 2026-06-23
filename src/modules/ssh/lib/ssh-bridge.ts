import { Channel, invoke } from "@tauri-apps/api/core";
import { toBytes } from "@/modules/terminal/lib/channelBytes";
import type { SshAuthMethod } from "./parseSshCommand";

export interface SshSession {
  id: number;
  write: (data: string) => Promise<void>;
  resize: (cols: number, rows: number) => Promise<void>;
  close: () => Promise<void>;
}

export interface OpenSshOptions {
  connectionId: string;
  host: string;
  port: number;
  user: string;
  authMethod: SshAuthMethod;
  keyPath?: string;
  cols: number;
  rows: number;
  onData: (bytes: Uint8Array) => void;
  onExit: (code: number) => void;
}

export async function openSsh(opts: OpenSshOptions): Promise<SshSession> {
  const onData = new Channel<unknown>();
  onData.onmessage = (m) => opts.onData(toBytes(m));
  const onExit = new Channel<number>();
  onExit.onmessage = (code) => opts.onExit(code);

  const id = await invoke<number>("ssh_open", {
    req: {
      connectionId: opts.connectionId,
      host: opts.host,
      port: opts.port,
      user: opts.user,
      authMethod: opts.authMethod,
      keyPath: opts.keyPath,
      cols: opts.cols,
      rows: opts.rows,
    },
    onData,
    onExit,
  });

  return {
    id,
    write: (data) => invoke("ssh_write", { id, data }),
    resize: (cols, rows) => invoke("ssh_resize", { id, cols, rows }),
    close: () => invoke("ssh_close", { id }),
  };
}
