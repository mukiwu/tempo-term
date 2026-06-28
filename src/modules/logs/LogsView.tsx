import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { FolderOpen, RefreshCw } from "lucide-react";
import { useSettingsStore } from "@/stores/settingsStore";
import {
  enforceLogRetention,
  listSessionLogs,
  openSessionLogsDir,
  readSessionLog,
  saveTextAs,
  type LogEntry,
} from "./lib/sessionLog";
import { renderLogToText } from "./lib/renderLog";

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function LogsView() {
  const { t } = useTranslation();
  const retentionDays = useSettingsStore((s) => s.logRetentionDays);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [content, setContent] = useState("");
  const [showRaw, setShowRaw] = useState(false);
  const [loading, setLoading] = useState(false);
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

  async function decode(raw: Uint8Array, rawMode: boolean) {
    if (rawMode) {
      setContent(new TextDecoder("utf-8", { fatal: false }).decode(raw));
    } else {
      setContent(await renderLogToText(raw));
    }
  }

  async function select(name: string) {
    setSelected(name);
    setLoading(true);
    setError(null);
    setContent("");
    setBytes(null);
    try {
      const raw = await readSessionLog(name);
      setBytes(raw);
      await decode(raw, showRaw);
    } catch (e: unknown) {
      setError(`read: ${String(e)}`);
    } finally {
      setLoading(false);
    }
  }

  async function toggleRaw() {
    const next = !showRaw;
    setShowRaw(next);
    if (!bytes) return;
    setLoading(true);
    try {
      await decode(bytes, next);
    } finally {
      setLoading(false);
    }
  }

  async function saveAs() {
    if (!selected) return;
    const suggested = selected.replace(/\.log$/, showRaw ? ".raw.log" : ".txt");
    await saveTextAs(suggested, content);
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
            onClick={() => void openSessionLogsDir()}
            className="rounded p-1 text-fg-subtle hover:bg-bg-elevated hover:text-fg"
          >
            <FolderOpen size={14} />
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="w-56 shrink-0 overflow-auto border-r border-border p-1">
          {entries.length === 0 ? (
            <div className="p-4 text-center text-xs text-fg-muted">{t("logs.empty")}</div>
          ) : (
            entries.map((e) => (
              <button
                key={e.name}
                type="button"
                onClick={() => void select(e.name)}
                className={`flex w-full flex-col gap-0.5 rounded px-2 py-1.5 text-left ${
                  selected === e.name ? "bg-accent/15 text-accent" : "text-fg hover:bg-bg-elevated"
                }`}
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

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border px-3 text-xs text-fg-muted">
            {selected ? (
              <>
                <span className="truncate">{selected}</span>
                <label className="ml-auto flex cursor-pointer items-center gap-1">
                  <input
                    type="checkbox"
                    checked={showRaw}
                    onChange={() => void toggleRaw().catch(() => {})}
                    disabled={loading || !bytes}
                    className="accent-accent"
                  />
                  {t("logs.raw")}
                </label>
                <button
                  type="button"
                  onClick={() => void navigator.clipboard.writeText(content).catch(() => {})}
                  disabled={!content}
                  className="rounded border border-border px-2 py-0.5 hover:bg-bg-elevated disabled:opacity-50"
                >
                  {t("logs.copy")}
                </button>
                <button
                  type="button"
                  onClick={() => void saveAs().catch(() => {})}
                  disabled={!content}
                  className="rounded border border-border px-2 py-0.5 hover:bg-bg-elevated disabled:opacity-50"
                >
                  {t("logs.saveAs")}
                </button>
              </>
            ) : (
              <span>{t("logs.selectHint")}</span>
            )}
          </div>
          {error && <div className="px-3 py-2 text-xs text-danger">{error}</div>}
          {loading && <div className="px-3 py-2 text-xs text-fg-muted">{t("logs.loading")}</div>}
          <pre className="m-0 flex-1 overflow-auto whitespace-pre p-3 font-mono text-xs text-fg">
            {content}
          </pre>
        </div>
      </div>
    </div>
  );
}
