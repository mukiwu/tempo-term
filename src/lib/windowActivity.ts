import { invoke } from "@tauri-apps/api/core";
import { useSyncExternalStore } from "react";

let visible = typeof document === "undefined" || document.visibilityState === "visible";
const listeners = new Set<() => void>();
let initialized = false;

function hasTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function syncBackendActivity(): void {
  if (hasTauriRuntime()) {
    void invoke("pty_set_window_active", { active: visible }).catch(() => {});
    void invoke("ssh_set_window_active", { active: visible }).catch(() => {});
  }
}

function publish(next: boolean): void {
  if (next === visible) return;
  visible = next;
  for (const listener of listeners) listener();
  syncBackendActivity();
}

function initialize(): void {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  visible = document.visibilityState === "visible";
  document.addEventListener("visibilitychange", () => {
    publish(document.visibilityState === "visible");
  });
  // Rust defaults sessions to active. Publish the actual initial state as well
  // as later transitions so a window restored hidden cannot leak IPC output.
  syncBackendActivity();
}

export function isWindowVisible(): boolean {
  initialize();
  return visible;
}

export function useWindowVisible(): boolean {
  initialize();
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    () => visible,
    () => true,
  );
}
