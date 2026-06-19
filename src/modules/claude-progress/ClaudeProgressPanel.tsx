import { useState } from "react";
import { Check, ChevronDown, ChevronRight, CircleDot, Loader2, Square, X } from "lucide-react";
import { activeCount, isEmptyProgress, useProgressStore } from "./lib/progressStore";
import type { ProgressState, SubagentProgress } from "./lib/progressState";
import { deriveStatus } from "./lib/progressState";
import type { TodoItem } from "./lib/normalize";
import { basename } from "@/modules/explorer/lib/paths";

const STATUS_LABEL: Record<ReturnType<typeof deriveStatus>, string> = {
  active: "正在執行",
  thinking: "思考中",
  idle: "等待輸入",
};

function Subagent({ sub }: { sub: SubagentProgress }) {
  const running = sub.status === "running";
  const secs = sub.durationMs != null ? (sub.durationMs / 1000).toFixed(1) : null;
  return (
    <div className="flex items-start gap-2 rounded-lg border border-border bg-bg px-2.5 py-2">
      {running ? (
        <Loader2 size={13} className="mt-0.5 shrink-0 animate-spin text-accent" />
      ) : (
        <Check size={13} className="mt-0.5 shrink-0 text-success" />
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-fg">{sub.agentType}</div>
        {sub.description && <div className="truncate text-fg-subtle">{sub.description}</div>}
        {!running && secs && (
          <div className="mt-0.5 text-fg-subtle">
            {secs}s · {sub.tokens?.toLocaleString()} tok · {sub.toolUseCount} tools
          </div>
        )}
      </div>
    </div>
  );
}

function TodoRow({ item }: { item: TodoItem }) {
  const icon =
    item.status === "completed" ? (
      <Check size={12} className="mt-0.5 shrink-0 text-success" />
    ) : item.status === "in_progress" ? (
      <CircleDot size={12} className="mt-0.5 shrink-0 animate-pulse text-accent" />
    ) : (
      <Square size={12} className="mt-0.5 shrink-0 text-fg-subtle" />
    );
  return (
    <div className="flex items-start gap-2">
      {icon}
      <span className={item.status === "completed" ? "text-fg-subtle line-through" : "text-fg-muted"}>
        {item.text}
      </span>
    </div>
  );
}

function SessionBody({ progress }: { progress: ProgressState }) {
  const { activities, subagents, todos } = progress;
  return (
    <div className="space-y-3 px-2.5 pb-2.5 pt-1 text-xs">
      {subagents.length > 0 && (
        <section className="space-y-1.5">
          <h4 className="text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
            Subagents
          </h4>
          {subagents.map((sub) => (
            <Subagent key={sub.id} sub={sub} />
          ))}
        </section>
      )}

      {activities.length > 0 && (
        <section className="space-y-1">
          <h4 className="text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
            活動
          </h4>
          {activities.map((activity) => (
            <div key={activity.id} className="flex items-center gap-2 text-fg-muted">
              {activity.status === "running" ? (
                <Loader2 size={12} className="shrink-0 animate-spin text-accent" />
              ) : activity.status === "error" ? (
                <X size={12} className="shrink-0 text-fg-subtle" />
              ) : (
                <Check size={12} className="shrink-0 text-success" />
              )}
              <span
                className={
                  activity.status === "running" ? "truncate" : "truncate text-fg-subtle"
                }
              >
                {activity.name}
              </span>
            </div>
          ))}
        </section>
      )}

      {todos.length > 0 && (
        <section className="space-y-1">
          <h4 className="text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
            Todo（{todos.filter((t) => t.status === "completed").length}/{todos.length}）
          </h4>
          {todos.map((item) => (
            <TodoRow key={item.text} item={item} />
          ))}
        </section>
      )}
    </div>
  );
}

interface SessionSectionProps {
  cwd: string;
  progress: ProgressState;
  collapsed: boolean;
  onToggle: () => void;
}

function SessionSection({ cwd, progress, collapsed, onToggle }: SessionSectionProps) {
  const running = activeCount(progress);
  const status = deriveStatus(progress);
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-bg-inset">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-1.5 px-2.5 py-2 text-left hover:bg-bg"
      >
        {collapsed ? (
          <ChevronRight size={13} className="shrink-0 text-fg-subtle" />
        ) : (
          <ChevronDown size={13} className="shrink-0 text-fg-subtle" />
        )}
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-fg" title={cwd}>
          {basename(cwd)}
        </span>
        <span className="shrink-0 text-[10px] text-fg-subtle">{STATUS_LABEL[status]}</span>
        {running > 0 && (
          <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[9px] font-bold leading-none text-bg">
            {running}
          </span>
        )}
      </button>
      {!collapsed && <SessionBody progress={progress} />}
    </section>
  );
}

export function ClaudeProgressPanel() {
  const sessions = useProgressStore((s) => s.sessions);
  const open = useProgressStore((s) => s.panelOpen);
  const setPanelOpen = useProgressStore((s) => s.setPanelOpen);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  if (!open) {
    return null;
  }

  const entries = Object.entries(sessions).filter(([, progress]) => !isEmptyProgress(progress));

  return (
    <div className="fixed bottom-9 right-2 z-40 flex max-h-[70vh] w-80 flex-col overflow-hidden rounded-xl border border-border-strong bg-bg-elevated shadow-2xl">
      <header className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-xs font-semibold text-fg">Claude 進度</span>
        <button
          type="button"
          onClick={() => setPanelOpen(false)}
          aria-label="關閉"
          className="flex h-5 w-5 items-center justify-center rounded text-fg-subtle transition-colors hover:text-fg"
        >
          <X size={14} />
        </button>
      </header>

      <div className="flex-1 space-y-2 overflow-y-auto p-2">
        {entries.length === 0 ? (
          <p className="py-6 text-center text-xs text-fg-subtle">目前沒有 Claude 活動</p>
        ) : (
          entries.map(([cwd, progress]) => (
            <SessionSection
              key={cwd}
              cwd={cwd}
              progress={progress}
              collapsed={collapsed[cwd] ?? false}
              onToggle={() =>
                setCollapsed((current) => ({ ...current, [cwd]: !(current[cwd] ?? false) }))
              }
            />
          ))
        )}
      </div>
    </div>
  );
}
