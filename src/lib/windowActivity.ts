import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useSyncExternalStore } from "react";

let focused = true;
let visible = typeof document === "undefined" || document.visibilityState === "visible";
let current = focused && visible;
const listeners = new Set<() => void>();
let initialized = false;

function hasTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function publish(): void {
  const next = focused && visible;
  if (next === current) return;
  current = next;
  for (const listener of listeners) listener();
  if (hasTauriRuntime()) {
    void invoke("pty_set_window_active", { active: current }).catch(() => {});
    void invoke("ssh_set_window_active", { active: current }).catch(() => {});
  }
}

function initialize(): void {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  document.addEventListener("visibilitychange", () => {
    visible = document.visibilityState === "visible";
    publish();
  });
  window.addEventListener("focus", () => { focused = true; publish(); });
  window.addEventListener("blur", () => { focused = false; publish(); });
  if (hasTauriRuntime()) {
    try {
      const win = getCurrentWindow();
      void win.isFocused().then((value) => { focused = value; publish(); }).catch(() => {});
      void win.onFocusChanged(({ payload }) => { focused = payload; publish(); }).catch(() => {});
    } catch {
      // Partial Tauri mocks and browser previews do not expose window metadata.
    }
  }
}

export function isWindowActive(): boolean {
  initialize();
  return current;
}

export function useWindowActive(): boolean {
  initialize();
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    () => current,
    () => true,
  );
}
