import { useState } from "react";
import { useTranslation } from "react-i18next";
import { message } from "@tauri-apps/plugin-dialog";
import { useSettingsStore } from "@/stores/settingsStore";
import { useTabsStore } from "@/stores/tabsStore";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { usePorts } from "./lib/usePorts";
import { killPortProcess, type PortInfo } from "./lib/portsBridge";
import { PortRow } from "./PortRow";

/**
 * The in-column Ports panel. Same data + actions as the old StatusBar popover
 * (`PortsIndicator` / `PortsPanel`), minus the fixed-overlay chrome — a docked
 * panel fills its column body. Mounts only while it is the active panel on its
 * side, so `usePorts` polls only when the panel is actually showing.
 */
export function PortsPanelView() {
  const { t } = useTranslation();
  const showAll = useSettingsStore((s) => s.showAllPorts);
  const setShowAll = useSettingsStore((s) => s.setShowAllPorts);
  const ports = usePorts(showAll, 5000);
  const [killTarget, setKillTarget] = useState<PortInfo | null>(null);
  const [expandedPid, setExpandedPid] = useState<number | null>(null);

  const list = ports ?? [];

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
      void message(t("ports.killFailed", { process: target.processName, error: detail }), {
        title: t("ports.kill"),
        kind: "error",
      });
    });
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
        <span className="text-sm font-semibold text-fg">{t("ports.title")}</span>
        <label className="flex items-center gap-2 text-xs text-fg-muted">
          {t("ports.showAll")}
          <button
            type="button"
            role="switch"
            aria-checked={showAll}
            aria-label={t("ports.showAll")}
            onClick={() => setShowAll(!showAll)}
            className={`relative h-4 w-7 rounded-full transition-colors ${showAll ? "bg-accent" : "bg-border"}`}
          >
            <span
              className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-transform ${showAll ? "left-3.5" : "left-0.5"}`}
            />
          </button>
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {ports === null ? (
          <div className="px-3 py-6 text-center text-sm text-fg-subtle">{t("ports.loading")}</div>
        ) : list.length === 0 ? (
          <div className="px-3 py-6 text-center text-sm text-fg-subtle">{t("ports.empty")}</div>
        ) : (
          list.map((port) => (
            <PortRow
              key={`${port.port}-${port.pid}`}
              port={port}
              expanded={expandedPid === port.pid}
              onToggleExpand={() => setExpandedPid((cur) => (cur === port.pid ? null : port.pid))}
              onRequestKill={setKillTarget}
              onOpenTerminal={openTerminal}
            />
          ))
        )}
      </div>
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
