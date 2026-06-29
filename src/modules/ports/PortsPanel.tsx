import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { PortInfo } from "./lib/portsBridge";
import { PortRow } from "./PortRow";

interface PortsPanelProps {
  ports: PortInfo[] | null;
  open: boolean;
  onClose: () => void;
  showAll: boolean;
  onToggleShowAll: (value: boolean) => void;
  onRequestKill: (port: PortInfo) => void;
  onOpenTerminal: (port: PortInfo) => void;
}

export function PortsPanel({
  ports,
  open,
  onClose,
  showAll,
  onToggleShowAll,
  onRequestKill,
  onOpenTerminal,
}: PortsPanelProps) {
  const { t } = useTranslation();
  const [expandedPid, setExpandedPid] = useState<number | null>(null);

  if (!open) {
    return null;
  }

  const list = ports ?? [];

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} aria-hidden />
      <div className="absolute bottom-8 right-2 z-50 flex max-h-[60vh] w-[420px] flex-col rounded-lg border border-border bg-bg-elevated shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-sm font-semibold text-fg">{t("ports.title")}</span>
          <label className="flex items-center gap-2 text-xs text-fg-muted">
            {t("ports.showAll")}
            <button
              type="button"
              role="switch"
              aria-checked={showAll}
              aria-label={t("ports.showAll")}
              onClick={() => onToggleShowAll(!showAll)}
              className={`relative h-4 w-7 rounded-full transition-colors ${showAll ? "bg-accent" : "bg-border"}`}
            >
              <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-transform ${showAll ? "left-3.5" : "left-0.5"}`} />
            </button>
          </label>
        </div>
        <div className="overflow-y-auto">
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
                onRequestKill={onRequestKill}
                onOpenTerminal={onOpenTerminal}
              />
            ))
          )}
        </div>
      </div>
    </>
  );
}
