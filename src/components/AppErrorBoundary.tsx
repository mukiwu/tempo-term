import React from "react";
import { invoke } from "@tauri-apps/api/core";
import i18n from "@/i18n";
import { RECOVERY_RELOAD_MARKER, reloadWorkspace } from "@/lib/recovery";

export class AppErrorBoundary extends React.Component<
  React.PropsWithChildren,
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    // This runs before React unmounts the terminal tree. Mark the teardown as a
    // renderer recovery so component cleanup detaches instead of killing the
    // Rust-owned PTY/SSH sessions the error screen promises to preserve.
    sessionStorage.setItem(RECOVERY_RELOAD_MARKER, "1");
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error("TempoTerm renderer error", error);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="flex h-screen w-screen items-center justify-center bg-bg p-8 text-fg">
        <section className="max-w-lg rounded-xl border border-border bg-surface p-6 shadow-2xl">
          <h1 className="text-xl font-semibold">{i18n.t("recovery.errorTitle")}</h1>
          <p className="mt-2 text-sm text-muted">{i18n.t("recovery.errorMessage")}</p>
          <div className="mt-5 flex gap-2">
            <button
              className="rounded bg-accent px-3 py-2 text-sm text-white"
              onClick={() => void reloadWorkspace()}
            >
              {i18n.t("recovery.reload")}
            </button>
            <button
              className="rounded border border-border px-3 py-2 text-sm"
              onClick={() => void invoke("recovery_reveal_log")}
            >
              {i18n.t("recovery.revealLog")}
            </button>
          </div>
        </section>
      </main>
    );
  }
}
