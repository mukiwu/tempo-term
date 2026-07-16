import { EthernetPort } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useUiStore } from "@/stores/uiStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { Tooltip } from "@/components/Tooltip";
import { usePorts } from "./lib/usePorts";

/**
 * StatusBar badge showing how many ports are listening. Clicking it reveals the
 * Ports panel (which owns the list, kill, and open-terminal actions) on whichever
 * dock column it lives in. Polls slowly — it only feeds the count; the open panel
 * polls briskly on its own.
 */
export function PortsIndicator() {
  const { t } = useTranslation();
  const showAll = useSettingsStore((s) => s.showAllPorts);
  const activatePanel = useUiStore((s) => s.activatePanel);
  const ports = usePorts(showAll, 15000);

  const count = ports?.length ?? 0;
  if (count === 0) {
    return null;
  }

  return (
    <Tooltip label={t("ports.title")} side="top">
      <button
        type="button"
        aria-label={t("ports.count", { count })}
        onClick={() => activatePanel("ports")}
        className="flex h-5 items-center gap-1 rounded px-1.5 text-fg-subtle transition-colors hover:text-fg"
      >
        <EthernetPort size={14} strokeWidth={1.75} />
        <span className="text-xs">{count}</span>
      </button>
    </Tooltip>
  );
}
