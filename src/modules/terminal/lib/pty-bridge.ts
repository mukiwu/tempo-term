import { Channel, invoke } from "@tauri-apps/api/core";

export interface PtySession {
  id: number;
  write: (data: string) => Promise<void>;
  resize: (cols: number, rows: number) => Promise<void>;
  close: () => Promise<void>;
  cwd: () => Promise<string | null>;
}

export interface OpenPtyOptions {
  cols: number;
  rows: number;
  cwd?: string;
  onData: (bytes: Uint8Array) => void;
  onExit: (code: number) => void;
}

/**
 * Normalise whatever shape the channel delivers (ArrayBuffer, a typed array,
 * or a plain number array) into a Uint8Array, so terminal output renders
 * regardless of how Tauri serialises the binary payload.
 */
function toBytes(message: unknown): Uint8Array {
  if (message instanceof Uint8Array) {
    return message;
  }
  if (message instanceof ArrayBuffer) {
    return new Uint8Array(message);
  }
  if (Array.isArray(message)) {
    return Uint8Array.from(message as number[]);
  }
  if (message && typeof message === "object" && "data" in message) {
    const data = (message as { data: unknown }).data;
    if (Array.isArray(data)) {
      return Uint8Array.from(data as number[]);
    }
    if (data instanceof ArrayBuffer) {
      return new Uint8Array(data);
    }
  }
  return new Uint8Array();
}

/**
 * Open a PTY in the Rust backend and wire its binary output stream to the
 * caller. Output arrives over a Tauri Channel; input, resize and close go back
 * through ordinary invoke calls.
 */
export async function openPty(opts: OpenPtyOptions): Promise<PtySession> {
  const onData = new Channel<unknown>();
  onData.onmessage = (message) => opts.onData(toBytes(message));

  const onExit = new Channel<number>();
  onExit.onmessage = (code) => opts.onExit(code);

  const id = await invoke<number>("pty_open", {
    cols: opts.cols,
    rows: opts.rows,
    cwd: opts.cwd,
    onData,
    onExit,
  });

  return {
    id,
    write: (data) => invoke("pty_write", { id, data }),
    resize: (cols, rows) => invoke("pty_resize", { id, cols, rows }),
    close: () => invoke("pty_close", { id }),
    cwd: () => invoke<string | null>("pty_cwd", { id }),
  };
}
