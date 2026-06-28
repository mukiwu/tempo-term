import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { readSessionLog, saveTextAs } from "./lib/sessionLog";
import { renderLogToText } from "./lib/renderLog";

interface LogTabContentProps {
  logName: string;
}

export function LogTabContent({ logName }: LogTabContentProps) {
  const { t } = useTranslation();
  const [content, setContent] = useState("");
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Tracks the most recently requested log name so that a slow renderLogToText
  // for an older logName cannot overwrite content after the prop has changed.
  const requestedRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    requestedRef.current = logName;
    setLoading(true);
    setError(null);
    setContent("");
    setBytes(null);
    setShowRaw(false);

    void (async () => {
      try {
        const raw = await readSessionLog(logName);
        if (cancelled || requestedRef.current !== logName) return;
        const text = await renderLogToText(raw);
        if (cancelled || requestedRef.current !== logName) return;
        setBytes(raw);
        setContent(text);
      } catch (e: unknown) {
        if (cancelled || requestedRef.current !== logName) return;
        setError(String(e instanceof Error ? e.message : e));
      } finally {
        if (!cancelled && requestedRef.current === logName) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [logName]);

  async function toggleRaw() {
    const next = !showRaw;
    setShowRaw(next);
    if (!bytes) return;
    const name = logName;
    setLoading(true);
    try {
      const decoded = next
        ? new TextDecoder("utf-8", { fatal: false }).decode(bytes)
        : await renderLogToText(bytes);
      if (requestedRef.current !== name) return;
      setContent(decoded);
    } finally {
      if (requestedRef.current === name) setLoading(false);
    }
  }

  async function handleSaveAs() {
    const suggested = logName.replace(/\.log$/, showRaw ? ".raw.log" : ".txt");
    await saveTextAs(suggested, content);
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border px-3 text-xs text-fg-muted">
        <span className="truncate">{logName}</span>
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
          onClick={() => void handleSaveAs().catch(() => {})}
          disabled={!content}
          className="rounded border border-border px-2 py-0.5 hover:bg-bg-elevated disabled:opacity-50"
        >
          {t("logs.saveAs")}
        </button>
      </div>
      {error && <div className="px-3 py-2 text-xs text-danger">{error}</div>}
      {loading && <div className="px-3 py-2 text-xs text-fg-muted">{t("logs.loading")}</div>}
      <pre className="m-0 flex-1 overflow-auto whitespace-pre p-3 font-mono text-xs text-fg">
        {content}
      </pre>
    </div>
  );
}
