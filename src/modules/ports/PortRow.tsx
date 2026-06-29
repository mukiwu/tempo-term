import { ChevronRight, Cpu, MemoryStick, Clock, SquareTerminal, X, Copy, SquareArrowOutUpRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
import { formatBytes, formatPercent } from "@/modules/sysmon/lib/format";
import { formatUptime } from "./lib/format";
import type { PortInfo } from "./lib/portsBridge";

interface PortRowProps {
  port: PortInfo;
  expanded: boolean;
  onToggleExpand: () => void;
  onRequestKill: (port: PortInfo) => void;
  onOpenTerminal: (port: PortInfo) => void;
}

export function PortRow({ port, expanded, onToggleExpand, onRequestKill, onOpenTerminal }: PortRowProps) {
  const { t } = useTranslation();
  const canKill = port.isCurrentUser;
  const canTerminal = Boolean(port.cwd);

  return (
    <div className="border-b border-border last:border-b-0">
      <div className="group flex items-center gap-3 px-3 py-2 text-sm">
        <span className="w-16 shrink-0 font-mono text-accent">:{port.port}</span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-fg">{port.processName}</div>
          <div className="flex items-center gap-3 text-xs text-fg-subtle">
            <span className="flex items-center gap-1"><Clock size={11} /> {formatUptime(port.uptimeSecs)}</span>
            <span className="flex items-center gap-1"><Cpu size={11} /> {formatPercent(port.cpuUsage)}</span>
            <span className="flex items-center gap-1"><MemoryStick size={11} /> {formatBytes(port.memoryBytes)}</span>
          </div>
        </div>
        <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            type="button"
            title={t("ports.openBrowser")}
            aria-label={t("ports.openBrowserFor", { port: port.port })}
            onClick={() => void openUrl(`http://localhost:${port.port}`)}
            className="flex h-6 w-6 items-center justify-center rounded text-fg-subtle hover:text-fg"
          >
            <SquareArrowOutUpRight size={14} />
          </button>
          <button
            type="button"
            title={t("ports.copy")}
            aria-label={t("ports.copyFor", { port: port.port })}
            onClick={() => void navigator.clipboard.writeText(port.command ?? `:${port.port} (pid ${port.pid})`)}
            className="flex h-6 w-6 items-center justify-center rounded text-fg-subtle hover:text-fg"
          >
            <Copy size={14} />
          </button>
          <button
            type="button"
            title={t("ports.openTerminal")}
            aria-label={t("ports.openTerminalFor", { port: port.port })}
            disabled={!canTerminal}
            onClick={() => onOpenTerminal(port)}
            className="flex h-6 w-6 items-center justify-center rounded text-fg-subtle hover:text-fg disabled:opacity-30"
          >
            <SquareTerminal size={14} />
          </button>
          <button
            type="button"
            title={t("ports.kill")}
            aria-label={t("ports.killPort", { port: port.port })}
            disabled={!canKill}
            onClick={() => onRequestKill(port)}
            className="flex h-6 w-6 items-center justify-center rounded text-fg-subtle hover:text-danger disabled:opacity-30"
          >
            <X size={14} />
          </button>
        </div>
        <button
          type="button"
          aria-label={t("ports.detailsFor", { port: port.port })}
          aria-expanded={expanded}
          onClick={onToggleExpand}
          className="flex h-6 w-6 items-center justify-center rounded text-fg-subtle hover:text-fg"
        >
          <ChevronRight size={14} className={expanded ? "rotate-90 transition-transform" : "transition-transform"} />
        </button>
      </div>
      {expanded && (
        <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 bg-bg-inset px-3 py-2 font-mono text-xs text-fg-muted">
          <dt className="text-fg-subtle">PID</dt>
          <dd>{port.pid}</dd>
          <dt className="text-fg-subtle">{t("ports.bind")}</dt>
          <dd>{port.bindAddr}:{port.port}</dd>
          <dt className="text-fg-subtle">{t("ports.command")}</dt>
          <dd className="break-all">{port.command ?? "-"}</dd>
          <dt className="text-fg-subtle">{t("ports.cwd")}</dt>
          <dd className="break-all">{port.cwd ?? "-"}</dd>
        </dl>
      )}
    </div>
  );
}
