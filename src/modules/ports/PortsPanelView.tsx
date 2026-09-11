import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pause, Play, RefreshCw, Search, X } from "lucide-react";
import { useSettingsStore } from "@/stores/settingsStore";
import { useTabsStore } from "@/stores/tabsStore";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { InfoDialog } from "@/components/InfoDialog";
import { Tooltip } from "@/components/Tooltip";
import { usePortMonitor } from "./lib/usePorts";
import { groupByProject } from "./lib/classifyService";
import { filterPorts } from "./lib/filterPorts";
import { killPortProcess, portsAiAvailable, type PortInfo } from "./lib/portsBridge";
import { PortRow } from "./PortRow";

/**
 * The in-column Ports panel. Same data + actions as the old StatusBar popover
 * (`PortsIndicator` / `PortsPanel`), minus the fixed-overlay chrome — a docked
 * panel fills its column body. Mounts only while it is the active panel on its
 * side, so `usePorts` polls only when the panel is actually showing.
 */
export function PortsPanelView() {
  const { t, i18n } = useTranslation();
  const showAll = useSettingsStore((s) => s.showAllPorts);
  const setShowAll = useSettingsStore((s) => s.setShowAllPorts);
  const [paused, setPaused] = useState(false);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const searchRef = useRef<HTMLInputElement>(null);
  const { ports, error, lastUpdatedAt, refreshing, refresh } = usePortMonitor(showAll, !paused, 5000);
  const [killTarget, setKillTarget] = useState<PortInfo | null>(null);
  const [killError, setKillError] = useState<string | null>(null);
  const [expandedPid, setExpandedPid] = useState<number | null>(null);
  const [aiAvailable, setAiAvailable] = useState(false);

  // One probe per mount: availability only changes with OS settings, and a
  // false (or failed) probe simply leaves the affordance hidden.
  useEffect(() => {
    let live = true;
    portsAiAvailable()
      .then((ok) => {
        if (live) setAiAvailable(ok);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const list = ports ?? [];
  const filtered = useMemo(() => filterPorts(list, deferredQuery), [deferredQuery, list]);
  const groups = useMemo(() => groupByProject(filtered), [filtered]);
  const hasQuery = query.trim().length > 0;
  const updatedTime = lastUpdatedAt === null
    ? null
    : new Intl.DateTimeFormat(i18n.language, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }).format(lastUpdatedAt);

  const openTerminal = (port: PortInfo) => {
    useTabsStore.getState().newTerminalTab(port.cwd ?? undefined);
  };

  const confirmKill = () => {
    const target = killTarget;
    setKillTarget(null);
    if (!target) {
      return;
    }
    void killPortProcess(target.port, target.pid).catch((err: unknown) => {
      const detail = err instanceof Error ? err.message : String(err);
      // Repo convention: failures surface in the app-styled dialog, never a
      // native alert (the one former exception in this file included).
      setKillError(t("ports.killFailed", { process: target.processName, error: detail }));
    });
  };

  return (
    <div
      className="flex h-full w-full flex-col overflow-hidden"
      onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
          event.preventDefault();
          searchRef.current?.focus();
        }
      }}
    >
      <div className="shrink-0 space-y-2 border-b border-border bg-bg-elevated/70 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-fg">{t("ports.title")}</span>
          <span
            className={`flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium ${
              paused ? "bg-warning/10 text-warning" : "bg-success/10 text-success"
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${paused ? "bg-warning" : "bg-success"}`} />
            {paused ? t("ports.paused") : t("ports.live")}
          </span>
          <div className="ml-auto flex items-center gap-1">
            <Tooltip label={paused ? t("ports.resume") : t("ports.pause")} side="bottom">
              <button
                type="button"
                aria-label={paused ? t("ports.resume") : t("ports.pause")}
                disabled={ports === null}
                onClick={() => setPaused((value) => !value)}
                className="flex h-7 w-7 items-center justify-center rounded text-fg-muted transition-colors hover:bg-bg-inset hover:text-fg disabled:opacity-30"
              >
                {paused ? <Play size={14} fill="currentColor" /> : <Pause size={14} fill="currentColor" />}
              </button>
            </Tooltip>
            <Tooltip label={t("ports.refresh")} side="bottom">
              <button
                type="button"
                aria-label={t("ports.refresh")}
                disabled={refreshing}
                onClick={() => void refresh()}
                className="flex h-7 w-7 items-center justify-center rounded text-fg-muted transition-colors hover:bg-bg-inset hover:text-fg disabled:opacity-40"
              >
                <RefreshCw size={14} className={refreshing ? "animate-spin" : undefined} />
              </button>
            </Tooltip>
          </div>
        </div>

        <div className="relative">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle" />
          <input
            ref={searchRef}
            type="search"
            value={query}
            aria-label={t("ports.search")}
            placeholder={t("ports.searchPlaceholder")}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && query) {
                event.stopPropagation();
                setQuery("");
              }
            }}
            className="h-8 w-full rounded-md border border-border bg-bg-inset pl-8 pr-8 text-xs text-fg outline-none transition-colors placeholder:text-fg-subtle focus:border-accent"
          />
          {query && (
            <button
              type="button"
              aria-label={t("ports.clearSearch")}
              onClick={() => {
                setQuery("");
                searchRef.current?.focus();
              }}
              className="absolute right-1 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-fg-subtle hover:text-fg"
            >
              <X size={13} />
            </button>
          )}
        </div>

        <div className="flex min-h-4 items-center gap-2 text-[10px] text-fg-subtle">
          <span className="tabular-nums">
            {hasQuery
              ? t("ports.resultCount", { visible: filtered.length, total: list.length })
              : t("ports.portCount", { count: list.length })}
          </span>
          {updatedTime && (
            <span className="ml-auto tabular-nums">
              {paused ? t("ports.snapshotAt", { time: updatedTime }) : t("ports.updatedAt", { time: updatedTime })}
            </span>
          )}
          <label className={`flex items-center gap-1.5 ${paused ? "opacity-40" : ""}`}>
            {t("ports.showAll")}
          <button
            type="button"
            role="switch"
            aria-checked={showAll}
            aria-label={t("ports.showAll")}
            disabled={paused}
            onClick={() => setShowAll(!showAll)}
            className={`relative h-4 w-7 rounded-full transition-colors ${showAll ? "bg-accent" : "bg-border"}`}
          >
            <span
              className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-transform ${showAll ? "left-3.5" : "left-0.5"}`}
            />
          </button>
        </label>
        </div>
      </div>
      {error && (
        <div role="alert" className="flex shrink-0 items-center gap-2 border-b border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          <span className="min-w-0 flex-1 truncate">{t("ports.refreshFailed")}</span>
          <button type="button" onClick={() => void refresh()} className="shrink-0 font-medium hover:underline">
            {t("ports.retry")}
          </button>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {ports === null ? (
          <div className="px-3 py-6 text-center text-sm text-fg-subtle">{t("ports.loading")}</div>
        ) : list.length === 0 ? (
          <div className="px-3 py-6 text-center text-sm text-fg-subtle">{t("ports.empty")}</div>
        ) : filtered.length === 0 ? (
          <div className="px-3 py-8 text-center">
            <p className="text-sm text-fg-muted">{t("ports.noSearchResults")}</p>
            <button type="button" onClick={() => setQuery("")} className="mt-2 text-xs text-accent hover:text-accent-hover">
              {t("ports.clearSearch")}
            </button>
          </div>
        ) : (
          groups.map((group) => (
            <section key={group.cwd ?? "__other__"}>
              {/* Port Radar's hierarchy: the project is the anchor a reader
                  scans for; the rows underneath stay sorted by port, so
                  nothing moves between polls. */}
              <h3 className="sticky top-0 flex items-baseline gap-2 border-b border-border bg-bg-elevated px-3 py-1.5 text-xs font-semibold text-fg">
                {group.name ?? t("ports.groupOther")}
                <span className="font-normal text-fg-subtle">{group.ports.length}</span>
              </h3>
              {group.ports.map((port) => (
                <PortRow
                  key={`${port.port}-${port.pid}`}
                  port={port}
                  aiAvailable={aiAvailable}
                  expanded={expandedPid === port.pid}
                  onToggleExpand={() => setExpandedPid((cur) => (cur === port.pid ? null : port.pid))}
                  onExpand={() => setExpandedPid(port.pid)}
                  onRequestKill={setKillTarget}
                  onOpenTerminal={openTerminal}
                />
              ))}
            </section>
          ))
        )}
      </div>
      {killError && (
        <InfoDialog
          title={t("ports.kill")}
          message={killError}
          confirmLabel={t("actions.confirm")}
          onConfirm={() => setKillError(null)}
        />
      )}
      {killTarget && (
        <ConfirmDialog
          title={t("ports.kill")}
          message={t("ports.killConfirm", { process: killTarget.processName, port: killTarget.port })}
          confirmLabel={t("ports.kill")}
          cancelLabel={t("actions.cancel")}
          onConfirm={confirmKill}
          onCancel={() => setKillTarget(null)}
        />
      )}
    </div>
  );
}
