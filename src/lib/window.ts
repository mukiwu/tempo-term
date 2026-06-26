import { getCurrentWindow } from "@tauri-apps/api/window";
import type { UnlistenFn } from "@tauri-apps/api/event";
import type { StateStorage } from "zustand/middleware";

/**
 * True for the primary window (label `main`). Also true when there is no Tauri
 * runtime (unit tests, web preview), so stores keep their default localStorage
 * behavior outside the app.
 */
export function isMainWindow(): boolean {
  try {
    return getCurrentWindow().label === "main";
  } catch {
    return true;
  }
}

/**
 * Window-control actions for the custom Windows title bar. They drive the
 * minimize / maximize-restore / close buttons; on macOS the native overlay
 * title bar handles this, so these are only wired up in the Windows TitleBar.
 */
export function minimizeWindow(): Promise<void> {
  return getCurrentWindow().minimize();
}

export function toggleMaximizeWindow(): Promise<void> {
  return getCurrentWindow().toggleMaximize();
}

export function closeWindow(): Promise<void> {
  return getCurrentWindow().close();
}

/** Whether the window is currently maximized (drives the maximize/restore icon). */
export function isWindowMaximized(): Promise<boolean> {
  return getCurrentWindow().isMaximized();
}

/** Subscribe to window resize events; returns an unlisten function. */
export function onWindowResized(handler: () => void): Promise<UnlistenFn> {
  return getCurrentWindow().onResized(() => handler());
}

// Private to this webview, so each secondary window gets its own isolated copy
// and never touches localStorage (which is shared across windows of the origin).
const memoryBacking = new Map<string, string>();
const memoryStorage: StateStorage = {
  getItem: (name) => memoryBacking.get(name) ?? null,
  setItem: (name, value) => {
    memoryBacking.set(name, value);
  },
  removeItem: (name) => {
    memoryBacking.delete(name);
  },
};

/**
 * Where a window's persisted content state lives: localStorage for the main
 * window (unchanged behavior), in-memory for secondary windows (fresh on open,
 * dropped on close, never shared).
 */
export function perWindowStorage(): StateStorage {
  return isMainWindow() ? localStorage : memoryStorage;
}
