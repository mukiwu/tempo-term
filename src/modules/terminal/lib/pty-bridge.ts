import { Channel, invoke } from "@tauri-apps/api/core";
import { toBytes } from "@/modules/terminal/lib/channelBytes";
import { useSettingsStore } from "@/stores/settingsStore";

export interface PtySession {
  id: number;
  write: (data: string) => Promise<void>;
  resize: (cols: number, rows: number) => Promise<void>;
  close: () => Promise<void>;
  cwd: () => Promise<string | null>;
  foregroundCommand: () => Promise<string | null>;
}

export interface OpenPtyOptions {
  cols: number;
  rows: number;
  cwd?: string;
  /**
   * Whether to load zsh-autosuggestions for this shell. Passed per spawn (read
   * from the user setting at open time) so a freshly opened or restored session
   * always reflects the current setting, with no startup race against a global.
   */
  suggestions: boolean;
  /**
   * Custom shell executable to spawn instead of the auto-detected one. Undefined
   * or empty keeps the backend's `$SHELL` / per-platform default. Tauri maps this
   * camelCase key onto the Rust command's `shell_override` argument.
   */
  shellOverride?: string;
  onData: (bytes: Uint8Array) => void;
  onExit: (code: number) => void;
}

// Session ids opened by THIS window's webview. Used to close only this window's
// PTYs when it closes (pty_close_all in the backend is global across windows).
const localSessions = new Set<number>();

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
    suggestions: opts.suggestions,
    shellOverride: opts.shellOverride,
    logEnabled: useSettingsStore.getState().loggingEnabled,
    onData,
    onExit,
  });
  localSessions.add(id);

  return {
    id,
    write: (data) => invoke("pty_write", { id, data }),
    resize: (cols, rows) => invoke("pty_resize", { id, cols, rows }),
    close: () => {
      localSessions.delete(id);
      return invoke("pty_close", { id });
    },
    cwd: () => invoke<string | null>("pty_cwd", { id }),
    foregroundCommand: () => invoke<string | null>("pty_foreground_command", { id }),
  };
}

/**
 * Close every PTY session this window opened, then clear the registry. Used on
 * window close so a secondary window leaves no orphan shells. Per-id errors are
 * swallowed so one failure does not block the others.
 */
export async function closeLocalSessions(): Promise<void> {
  const ids = [...localSessions];
  localSessions.clear();
  await Promise.all(
    ids.map((id) => invoke("pty_close", { id }).catch(() => {})),
  );
}
