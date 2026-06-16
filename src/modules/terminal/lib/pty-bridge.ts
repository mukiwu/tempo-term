import { Channel, invoke } from "@tauri-apps/api/core";

export interface PtySession {
  id: number;
  write: (data: string) => Promise<void>;
  resize: (cols: number, rows: number) => Promise<void>;
  close: () => Promise<void>;
}

export interface OpenPtyOptions {
  cols: number;
  rows: number;
  cwd?: string;
  onData: (bytes: Uint8Array) => void;
  onExit: (code: number) => void;
}

/**
 * Open a PTY in the Rust backend and wire its binary output stream to the
 * caller. Output arrives over a Tauri Channel as raw ArrayBuffers; input,
 * resize and close go back through ordinary invoke calls.
 */
export async function openPty(opts: OpenPtyOptions): Promise<PtySession> {
  const onData = new Channel<ArrayBuffer>();
  onData.onmessage = (message) => opts.onData(new Uint8Array(message));

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
  };
}
