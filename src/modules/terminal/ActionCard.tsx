import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { isDangerousCommand, type TerminalAction } from "./lib/actionLinks";

interface ActionCardProps {
  actions: TerminalAction[];
  onRun: (command: string) => void;
  /** Open a URL in the in-app web preview (for localhost/IP preview actions). */
  onOpenPreview?: (url: string) => void;
}

export function ActionCard({ actions, onRun, onOpenPreview }: ActionCardProps) {
  const { t } = useTranslation();
  // The command awaiting a destructive-action confirmation, or null when the
  // plain action list is showing.
  const [pending, setPending] = useState<string | null>(null);
  // Hover is tracked with JS mouse events rather than CSS :hover: this card pops
  // up dynamically and Tauri's WKWebview doesn't reliably recompute :hover for
  // elements that appear under the pointer, though mouse events still fire.
  const [hovered, setHovered] = useState<string | null>(null);

  function handleAction(action: TerminalAction) {
    if (action.previewUrl) {
      onOpenPreview?.(action.previewUrl);
    } else if (isDangerousCommand(action.command)) {
      setPending(action.command);
    } else {
      onRun(action.command);
    }
  }

  if (pending) {
    return (
      <div className="flex max-w-xs flex-col gap-2 rounded-md border border-danger/60 bg-bg-elevated p-2 shadow-lg">
        <div className="flex items-center gap-1.5 text-xs text-danger">
          <AlertTriangle size={13} className="shrink-0" />
          <span>{t("actionLinks.dangerWarning")}</span>
        </div>
        <code className="block max-h-24 overflow-y-auto whitespace-pre-wrap break-all rounded bg-bg-inset px-1.5 py-1 font-mono text-xs text-fg">
          {pending}
        </code>
        <div className="flex justify-end gap-1.5">
          <button
            type="button"
            className="rounded px-2 py-0.5 text-xs text-fg-muted hover:bg-border hover:text-fg"
            onClick={() => setPending(null)}
          >
            {t("actionLinks.cancel")}
          </button>
          <button
            type="button"
            className="rounded border border-danger/60 px-2 py-0.5 text-xs font-medium text-danger hover:bg-danger/10"
            onClick={() => {
              const command = pending;
              setPending(null);
              onRun(command);
            }}
          >
            {t("actionLinks.runAnyway")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col rounded-md border border-border-strong bg-bg-elevated py-1 shadow-lg">
      {actions.map((action) => {
        // command + arrow turn accent while the row is hovered, signalling it is
        // the runnable target.
        const isHovered = hovered === action.command;
        const accent = isHovered ? "text-accent" : "text-fg-subtle";
        return (
          <button
            key={action.command}
            type="button"
            className={`flex items-center gap-2 px-2.5 py-1 text-left text-xs ${
              isHovered ? "bg-border" : ""
            }`}
            onClick={() => handleAction(action)}
            onMouseEnter={() => setHovered(action.command)}
            onMouseLeave={() => setHovered((h) => (h === action.command ? null : h))}
          >
            <span className="min-w-16 font-medium text-fg">{t(action.labelKey)}</span>
            <code className={`font-mono ${accent}`}>{action.command}</code>
            <ArrowRight size={13} className={`ml-auto shrink-0 ${accent}`} />
          </button>
        );
      })}
    </div>
  );
}
