import { ChevronRight, Cpu, MemoryStick, Clock, SquareTerminal, X, Copy, SquareArrowOutUpRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
import { formatBytes, formatPercent } from "@/modules/sysmon/lib/format";
import { Tooltip } from "@/components/Tooltip";
import { formatUptime } from "./lib/format";
import type { PortInfo } from "./lib/portsBridge";

interface PortRowProps {
  port: PortInfo;
  expanded: boolean;
  onToggleExpand: () => void;
  onRequestKill: (port: PortInfo) => void;
  onOpenTerminal: (port: PortInfo) => void;
}

const ACTION_BTN = "flex h-6 w-6 items-center justify-center rounded text-fg-subtle transition-colors disabled:opacity-30";

export function PortRow({ port, expanded, onToggleExpand, onRequestKill, onOpenTerminal }: PortRowProps) {
  const { t } = useTranslation();
  const canKill = port.isCurrentUser;
  const canTerminal = Boolean(port.cwd);

  return (
    <div className="border-b border-border px-3 py-2 last:border-b-0">
      {/* Line 1: identifier on the left, resource stats on the right. */}
      <div className="flex items-center gap-2 text-sm">
        <span className="shrink-0 font-mono text-xs text-accent">:{port.port}</span>
        <span className="min-w-0 flex-1 truncate font-medium text-fg">{port.processName}</span>
        <div className="flex shrink-0 items-center gap-3 text-xs text-fg-subtle">
          <span className="flex items-center gap-1 whitespace-nowrap"><Clock size={11} /> {formatUptime(port.uptimeSecs)}</span>
          <span className="flex items-center gap-1 whitespace-nowrap"><Cpu size={11} /> {formatPercent(port.cpuUsage)}</span>
          <span className="flex items-center gap-1 whitespace-nowrap"><MemoryStick size={11} /> {formatBytes(port.memoryBytes)}</span>
        </div>
        <button
          type="button"
          aria-label={t("ports.detailsFor", { port: port.port })}
          aria-expanded={expanded}
          onClick={onToggleExpand}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-fg-subtle transition-colors hover:text-fg"
        >
          <ChevronRight size={14} className={expanded ? "rotate-90 transition-transform" : "transition-transform"} />
        </button>
      </div>

      {/* Line 2: actions, each with a tooltip explaining the icon. */}
      <div className="mt-1.5 flex items-center justify-end gap-1">
        <Tooltip label={t("ports.openBrowser")} side="top">
          <button
            type="button"
            aria-label={t("ports.openBrowserFor", { port: port.port })}
            onClick={() => void openUrl(`http://localhost:${port.port}`)}
            className={`${ACTION_BTN} hover:text-fg`}
          >
            <SquareArrowOutUpRight size={14} />
          </button>
        </Tooltip>
        <Tooltip label={t("ports.copy")} side="top">
          <button
            type="button"
            aria-label={t("ports.copyFor", { port: port.port })}
            onClick={() => void navigator.clipboard.writeText(port.command ?? `:${port.port} (pid ${port.pid})`)}
            className={`${ACTION_BTN} hover:text-fg`}
          >
            <Copy size={14} />
          </button>
        </Tooltip>
        <Tooltip label={canTerminal ? t("ports.openTerminal") : t("ports.openTerminalUnavailable")} side="top">
          <button
            type="button"
            aria-label={t("ports.openTerminalFor", { port: port.port })}
            disabled={!canTerminal}
            onClick={() => onOpenTerminal(port)}
            className={`${ACTION_BTN} hover:text-fg`}
          >
            <SquareTerminal size={14} />
          </button>
        </Tooltip>
        <Tooltip label={canKill ? t("ports.kill") : t("ports.killUnavailable")} side="top">
          <button
            type="button"
            aria-label={t("ports.killPort", { port: port.port })}
            disabled={!canKill}
            onClick={() => onRequestKill(port)}
            className={`${ACTION_BTN} hover:text-danger`}
          >
            <X size={14} />
          </button>
        </Tooltip>
      </div>

      {expanded && (
        <dl className="mt-1.5 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 rounded bg-bg-inset px-3 py-2 font-mono text-xs text-fg-muted">
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
