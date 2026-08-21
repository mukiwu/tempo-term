import { invoke, isTauri } from "@tauri-apps/api/core";
import { useEditorStore } from "@/modules/editor/store/editorStore";

export const RECOVERY_RELOAD_MARKER = "tempoterm-recovery-reload";
let runtimeIdPromise: Promise<string> | null = null;

export function runtimeInstanceId(): Promise<string> {
  runtimeIdPromise ??= isTauri()
    ? invoke<string>("runtime_instance_id")
    : Promise.resolve("browser-runtime");
  return runtimeIdPromise;
}

export function dirtyEditorSnapshot() {
  const buffers = useEditorStore.getState().buffers;
  return {
    buffers: Object.entries(buffers)
      .filter(([, value]) => value.content !== value.baseline)
      .map(([path, value]) => ({ path, content: value.content, baseline: value.baseline })),
  };
}

export async function syncRecoverySnapshot(): Promise<void> {
  if (!isTauri()) return;
  await invoke("recovery_sync_editor_snapshot", { snapshot: dirtyEditorSnapshot() });
}

export async function reloadWorkspace(): Promise<void> {
  sessionStorage.setItem(RECOVERY_RELOAD_MARKER, "1");
  try {
    await syncRecoverySnapshot();
    await invoke("recovery_reload_window");
  } catch (error) {
    sessionStorage.removeItem(RECOVERY_RELOAD_MARKER);
    const message = error instanceof Error ? error.message : String(error);
    window.alert(`目前無法安全地重新整理工作區。請先儲存較大的未儲存檔案後再試一次。\n\n${message}`);
    throw error;
  }
}
