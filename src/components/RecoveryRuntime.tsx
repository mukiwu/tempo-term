import { useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { AlertTriangle, RotateCcw, X } from "lucide-react";
import { useEditorStore } from "@/modules/editor/store/editorStore";
import { reloadWorkspace, syncRecoverySnapshot } from "@/lib/recovery";
import { sftpSessionStore } from "@/modules/ssh/lib/sftpSessionStore";

interface Notice { incidentId: string; reason: string; timestampMs: number; ptySessions: number; sshSessions: number; outputTruncated: boolean }
interface Snapshot { buffers: Array<{ path: string; content: string; baseline: string }> }
type SftpBinding = { connectionId: string; sessionId: number };

// React StrictMode mounts, unmounts, then mounts effects again in development.
// These are take-once backend commands, so share one request across both mounts
// or the throwaway first mount consumes the recovery data before the real UI.
let snapshotRequest: Promise<Snapshot | null> | null = null;
let noticeRequest: Promise<Notice | null> | null = null;
let sftpRequest: Promise<SftpBinding[]> | null = null;

export function RecoveryRuntime() {
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    if (!isTauri()) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const markerTimer = setTimeout(() => sessionStorage.removeItem("tempoterm-recovery-reload"), 0);
    const schedule = () => {
      clearTimeout(timer);
      clearTimeout(markerTimer);
      timer = setTimeout(() => void syncRecoverySnapshot().catch(() => {}), 250);
    };
    const unsubscribe = useEditorStore.subscribe(schedule);
    const onError = () => schedule();
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onError);
    snapshotRequest ??= invoke<Snapshot | null>("recovery_take_editor_snapshot");
    noticeRequest ??= invoke<Notice | null>("recovery_take_notice");
    sftpRequest ??= invoke<SftpBinding[]>("sftp_list_owned");
    void snapshotRequest.then((snapshot) => {
      if (snapshot) useEditorStore.getState().restoreBuffers(snapshot.buffers);
    });
    void noticeRequest.then(setNotice);
    void sftpRequest
      .then((bindings) => sftpSessionStore.getState().restore(bindings));
    const unlisten = getCurrentWebview().listen("recovery-prepare", () => {
      sessionStorage.setItem("tempoterm-recovery-reload", "1");
      void syncRecoverySnapshot().catch(() => {});
    });
    return () => {
      unsubscribe();
      clearTimeout(timer);
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onError);
      void unlisten.then((off) => off());
    };
  }, []);

  if (!notice) return null;
  return (
    <div role="alert" aria-live="assertive" className="fixed inset-x-4 top-10 z-[10000] flex items-center gap-3 rounded-lg border border-warning/40 bg-bg px-4 py-3 text-sm text-fg shadow-2xl">
      <AlertTriangle size={18} className="shrink-0 text-warning" />
      <div className="min-w-0 flex-1">
        <div className="font-medium">顯示程序已恢復，{notice.ptySessions} 個終端與 {notice.sshSessions} 個 SSH 工作階段已重新連線。</div>
        {notice.outputTruncated && <div className="mt-0.5 text-xs text-warning">部分較早的背景輸出已超過 1 MB 緩衝上限。</div>}
        <div className="mt-0.5 text-xs text-muted">事件編號：{notice.incidentId}</div>
      </div>
      <button aria-label="再次重新整理工作區" className="flex items-center gap-1 rounded px-2 py-1 hover:bg-hover" onClick={() => void reloadWorkspace()}>
        <RotateCcw size={14} /> 再次重新整理
      </button>
      <button
        aria-label="關閉復原提示"
        className="rounded p-1 hover:bg-hover"
        onClick={() => {
          setNotice(null);
          void invoke("recovery_dismiss_notice").catch(() => {});
        }}
      ><X size={16} /></button>
    </div>
  );
}
