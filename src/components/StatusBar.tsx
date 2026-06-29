import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowUp, ArrowUpCircle, Cpu, MemoryStick, Settings } from "lucide-react";
import { useUiStore } from "@/stores/uiStore";
import { useUpdaterStore } from "@/stores/updaterStore";
import { useSystemStats } from "@/modules/sysmon/lib/useSystemStats";
import { formatBytes, formatPercent, formatRate, ramPercent } from "@/modules/sysmon/lib/format";
import { Tooltip } from "@/components/Tooltip";
import { PortsIndicator } from "@/modules/ports/PortsIndicator";

export function StatusBar() {
  const { t } = useTranslation();
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);
  const hasUpdate = useUpdaterStore((s) => s.available !== null);
  const modalOpen = useUpdaterStore((s) => s.modalOpen);
  const openModal = useUpdaterStore((s) => s.openModal);
  const showIndicator = hasUpdate && !modalOpen;
  const stats = useSystemStats();

  return (
    <footer className="flex h-7 shrink-0 cursor-default items-center gap-1 border-t border-border bg-bg-inset px-2 text-xs text-fg-muted">
      {stats && (
        <span className="ml-2 flex items-center gap-3 font-mono text-fg-subtle">
          <Tooltip label={t("statusBar.cpu")} side="top">
            <span className="flex items-center gap-1">
              <Cpu size={11} /> {formatPercent(stats.cpuUsage)}
            </span>
          </Tooltip>
          <Tooltip
            label={t("statusBar.ramTooltip", {
              used: formatBytes(stats.ramUsed),
              total: formatBytes(stats.ramTotal),
            })}
            side="top"
          >
            <span className="flex items-center gap-1">
              <MemoryStick size={11} /> {formatPercent(ramPercent(stats.ramUsed, stats.ramTotal))}
            </span>
          </Tooltip>
          <Tooltip
            label={t("statusBar.netTooltip", {
              rx: formatRate(stats.netRx),
              tx: formatRate(stats.netTx),
            })}
            side="top"
          >
            <span className="flex items-center gap-2">
              <span className="flex items-center gap-1">
                <ArrowDown size={11} /> {formatRate(stats.netRx)}
              </span>
              <span className="flex items-center gap-1">
                <ArrowUp size={11} /> {formatRate(stats.netTx)}
              </span>
            </span>
          </Tooltip>
        </span>
      )}

      <div className="ml-auto flex items-center gap-1">
        <PortsIndicator />
        {showIndicator && (
          <button
            type="button"
            title={t("statusBar.updateAvailable")}
            aria-label={t("statusBar.updateAvailable")}
            onClick={openModal}
            className="flex h-5 items-center gap-1 rounded px-1.5 text-accent transition-colors hover:bg-bg-elevated"
          >
            <ArrowUpCircle size={13} strokeWidth={2} />
          </button>
        )}
        <button
          type="button"
          title={t("nav.settings")}
          aria-label={t("nav.settings")}
          onClick={() => setSettingsOpen(true)}
          className="flex h-5 w-6 items-center justify-center rounded text-fg-subtle transition-colors hover:text-fg"
        >
          <Settings size={14} strokeWidth={1.75} />
        </button>
      </div>
    </footer>
  );
}
