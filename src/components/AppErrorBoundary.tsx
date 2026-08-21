import React from "react";
import { invoke } from "@tauri-apps/api/core";
import { reloadWorkspace } from "@/lib/recovery";

export class AppErrorBoundary extends React.Component<React.PropsWithChildren, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { console.error("TempoTerm renderer error", error); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="flex h-screen w-screen items-center justify-center bg-bg p-8 text-fg">
        <section className="max-w-lg rounded-xl border border-border bg-surface p-6 shadow-2xl">
          <h1 className="text-xl font-semibold">工作區顯示發生錯誤</h1>
          <p className="mt-2 text-sm text-muted">執行中的終端與 SSH 工作階段會保留。你可以安全地重新整理工作區。</p>
          <div className="mt-5 flex gap-2">
            <button className="rounded bg-accent px-3 py-2 text-sm text-white" onClick={() => void reloadWorkspace()}>重新整理工作區</button>
            <button className="rounded border border-border px-3 py-2 text-sm" onClick={() => void invoke("recovery_reveal_log")}>在 Finder 顯示診斷紀錄</button>
          </div>
        </section>
      </main>
    );
  }
}
