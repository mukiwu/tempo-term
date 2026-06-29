import { useState } from "react";
import { EthernetPort } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useUiStore } from "@/stores/uiStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useTabsStore } from "@/stores/tabsStore";
import { message } from "@tauri-apps/plugin-dialog";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { usePorts } from "./lib/usePorts";
import { killPortProcess, type PortInfo } from "./lib/portsBridge";
import { PortsPanel } from "./PortsPanel";

export function PortsIndicator() {
  const { t } = useTranslation();
  const open = useUiStore((s) => s.portsPanelOpen);
  const setOpen = useUiStore((s) => s.setPortsPanelOpen);
  const showAll = useSettingsStore((s) => s.showAllPorts);
  const setShowAll = useSettingsStore((s) => s.setShowAllPorts);
  // Poll briskly while the panel is open, slowly while it is just feeding the badge.
  const ports = usePorts(showAll, open ? 5000 : 15000);
  const [killTarget, setKillTarget] = useState<PortInfo | null>(null);

  const count = ports?.length ?? 0;
  if (count === 0 && !open) {
    return null;
  }

  const openTerminal = (port: PortInfo) => {
    useTabsStore.getState().newTerminalTab(port.cwd ?? undefined);
    setOpen(false);
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
    <div className="relative">
      <button
        type="button"
        title={t("ports.title")}
        aria-label={t("ports.count", { count })}
        onClick={() => setOpen(!open)}
        className="flex h-5 items-center gap-1 rounded px-1.5 text-fg-subtle transition-colors hover:text-fg"
      >
        <EthernetPort size={14} strokeWidth={1.75} />
        <span className="text-xs">{count}</span>
      </button>
      <PortsPanel
        ports={ports}
        open={open}
        onClose={() => setOpen(false)}
        showAll={showAll}
        onToggleShowAll={setShowAll}
        onRequestKill={setKillTarget}
        onOpenTerminal={openTerminal}
      />
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
