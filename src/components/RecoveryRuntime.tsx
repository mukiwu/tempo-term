import { Fragment, type PropsWithChildren, useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { AlertTriangle, RotateCcw, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useEditorStore } from "@/modules/editor/store/editorStore";
import {
  RECOVERY_RELOAD_MARKER,
  reloadWorkspace,
  syncRecoverySnapshot,
} from "@/lib/recovery";
import { sftpSessionStore } from "@/modules/ssh/lib/sftpSessionStore";

interface Notice {
  incidentId: string;
  reason: string;
  timestampMs: number;
  ptySessions: number;
  sshSessions: number;
  outputTruncated: boolean;
}
interface Snapshot {
  buffers: Array<{ path: string; content: string; baseline: string }>;
}
type SftpBinding = { connectionId: string; sessionId: number };

// React StrictMode mounts, unmounts, then mounts effects again in development.
// These are take-once backend commands, so share one request across both mounts
// or the throwaway first mount consumes the recovery data before the real UI.
let bootstrapRequest: Promise<Notice | null> | null = null;

function bootstrapRecovery(): Promise<Notice | null> {
  bootstrapRequest ??= Promise.all([
    invoke<Snapshot | null>("recovery_take_editor_snapshot"),
    invoke<Notice | null>("recovery_take_notice"),
    invoke<SftpBinding[]>("sftp_list_owned"),
  ]).then(([snapshot, notice, bindings]) => {
    if (snapshot) useEditorStore.getState().restoreBuffers(snapshot.buffers);
    sftpSessionStore.getState().restore(bindings);
    return notice;
  });
  return bootstrapRequest;
}

export function RecoveryRuntime({ children }: PropsWithChildren) {
  const { t } = useTranslation();
  const tauri = isTauri();
  const [ready, setReady] = useState(!tauri);
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    if (!tauri) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void syncRecoverySnapshot().catch(() => {}), 250);
    };
    const unsubscribe = useEditorStore.subscribe(schedule);
    const onError = () => schedule();
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onError);
    void bootstrapRecovery()
      .then((nextNotice) => {
        if (!disposed) {
          // Automatic WebContent termination cannot set the frontend marker
          // before the renderer disappears. Set it from the Rust notice before
          // mounting App, then keep it through StrictMode's development-only
          // mount/unmount/remount cycle so that pass only detaches sessions.
          if (nextNotice) sessionStorage.setItem(RECOVERY_RELOAD_MARKER, "1");
          setNotice(nextNotice);
          setReady(true);
        }
      })
      .catch(() => {
        // A recovery service failure must not leave the workspace permanently
        // blank. The normal stores can still start from their persisted state.
        if (!disposed) setReady(true);
      });
    const unlisten = getCurrentWebview().listen("recovery-prepare", () => {
      sessionStorage.setItem(RECOVERY_RELOAD_MARKER, "1");
      void syncRecoverySnapshot().catch(() => {});
    });
    return () => {
      disposed = true;
      unsubscribe();
      clearTimeout(timer);
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onError);
      void unlisten.then((off) => off());
    };
  }, [tauri]);

  if (!ready) return null;
  return (
    <Fragment>
      {children}
      {notice && (
        <div
          role="alert"
          aria-live="assertive"
          className="fixed inset-x-4 top-10 z-[10000] flex items-center gap-3 rounded-lg border border-warning/40 bg-bg px-4 py-3 text-sm text-fg shadow-2xl"
        >
          <AlertTriangle size={18} className="shrink-0 text-warning" />
          <div className="min-w-0 flex-1">
            <div className="font-medium">
              {t("recovery.restored", {
                pty: notice.ptySessions,
                ssh: notice.sshSessions,
              })}
            </div>
            {notice.outputTruncated && (
              <div className="mt-0.5 text-xs text-warning">{t("recovery.truncated")}</div>
            )}
            <div className="mt-0.5 text-xs text-muted">
              {t("recovery.incident", { id: notice.incidentId })}
            </div>
          </div>
          <button
            aria-label={t("recovery.reloadAgain")}
            className="flex items-center gap-1 rounded px-2 py-1 hover:bg-hover"
            onClick={() => void reloadWorkspace()}
          >
            <RotateCcw size={14} /> {t("recovery.reloadAgain")}
          </button>
          <button
            aria-label={t("recovery.dismiss")}
            className="rounded p-1 hover:bg-hover"
            onClick={() => {
              setNotice(null);
              void invoke("recovery_dismiss_notice").catch(() => {});
            }}
          >
            <X size={16} />
          </button>
        </div>
      )}
    </Fragment>
  );
}
