import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { FolderOpen, RefreshCw } from "lucide-react";
import { useSettingsStore } from "@/stores/settingsStore";
import { useTabsStore } from "@/stores/tabsStore";
import {
  enforceLogRetention,
  listSessionLogs,
  openSessionLogsDir,
  type LogEntry,
} from "./lib/sessionLog";

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function LogsView() {
  const { t } = useTranslation();
  const retentionDays = useSettingsStore((s) => s.logRetentionDays);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      setEntries(await listSessionLogs());
    } catch (e: unknown) {
      setError(`list: ${String(e)}`);
    }
  }

  // Enforce retention once when the panel mounts, then list what remains.
  useEffect(() => {
    void enforceLogRetention(retentionDays).catch(() => {}).finally(() => void refresh());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleLogClick(name: string) {
    useTabsStore.getState().openLogTab(name);
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3 text-sm font-medium text-fg">
        {t("logs.title")}
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            aria-label={t("logs.refresh")}
            onClick={() => void refresh()}
            className="rounded p-1 text-fg-subtle hover:bg-bg-elevated hover:text-fg"
          >
            <RefreshCw size={14} />
          </button>
          <button
            type="button"
            aria-label={t("logs.openFolder")}
            onClick={() => void openSessionLogsDir().catch(() => {})}
            className="rounded p-1 text-fg-subtle hover:bg-bg-elevated hover:text-fg"
          >
            <FolderOpen size={14} />
          </button>
        </div>
      </div>

      {error && <div className="px-3 py-2 text-xs text-danger">{error}</div>}

      <div className="flex-1 overflow-auto p-1">
        {entries.length === 0 ? (
          <div className="p-4 text-center text-xs text-fg-muted">{t("logs.empty")}</div>
        ) : (
          entries.map((e) => (
            <button
              key={e.name}
              type="button"
              onClick={() => handleLogClick(e.name)}
              className="flex w-full flex-col gap-0.5 rounded px-2 py-1.5 text-left text-fg hover:bg-bg-elevated"
              title={e.name}
            >
              <span className="truncate text-xs">{e.name}</span>
              <span className="flex justify-between text-[10px] text-fg-muted">
                <span>{new Date(e.modified_unix_ms).toLocaleString()}</span>
                <span>{fmtSize(e.size)}</span>
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
