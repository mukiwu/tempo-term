import { getCurrentWindow } from "@tauri-apps/api/window";
import { emitTo, type UnlistenFn } from "@tauri-apps/api/event";
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

/**
 * Fire a `menu:*` event to this window's own webview, mirroring exactly what the
 * native menu does on macOS (Rust `win.emit_to(win.label(), event)` in menu.rs).
 * Used by the Windows custom title-bar menu so a menu-bar click runs the same
 * frontend handler as the macOS menu item and the Ctrl+key shortcut — one source
 * of truth for each action's behaviour. Scoped to this window's label so a click
 * never triggers the action in another open window.
 */
export function emitWindowMenuEvent(event: string): Promise<void> {
  return emitTo(getCurrentWindow().label, event);
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
