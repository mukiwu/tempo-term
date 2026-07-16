import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { Tooltip } from "@/components/Tooltip";

/**
 * The unified h-7 strip at the top of every pane (see CONTEXT.md
 * "Pane header"): identity on the left, actions and the shared close button on
 * the right. Full headers pass `left`/`actions`; minimal ones (launcher,
 * git-graph, note, sessions) pass only the close handling and render nothing
 * else — which is why they only appear while the tab is split.
 */
export function PaneHeader({
  left,
  actions,
  showClose,
  onClose,
}: {
  left?: ReactNode;
  actions?: ReactNode;
  /** Hidden on a single-pane tab, where closing the pane means closing the tab. */
  showClose: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex h-7 shrink-0 items-center justify-between gap-2 border-b border-border pl-2 pr-1">
      {left ?? <span />}
      <div className="flex shrink-0 items-center gap-0.5">
        {actions}
        {showClose && (
          <Tooltip label={t("workspace.closePane")}>
            <button
              type="button"
              aria-label={t("workspace.closePane")}
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
              className="rounded p-1 text-fg-muted transition-colors hover:bg-danger/15 hover:text-danger"
            >
              <X size={14} />
            </button>
          </Tooltip>
        )}
      </div>
    </div>
  );
}
