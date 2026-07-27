import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { SquareMinus } from "lucide-react";
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
        {/*
          Deliberately not a ✕, and deliberately not the danger hover. This
          button sits one row below the tab bar's own ✕, and the two used to be
          near-identical glyphs a few pixels apart — with the colours the wrong
          way round, since the tab ✕ destroys the whole tab (shells included, no
          undo) while this one only peels off a split. So: the destructive close
          keeps the ✕ and takes the danger hover, and this one reads as
          "remove this cell" instead. The Panel and Columns icon families are
          out: they already mean the sidebar toggles and the editor's split
          mode.
        */}
        {showClose && (
          <Tooltip label={t("workspace.closePane")}>
            <button
              type="button"
              aria-label={t("workspace.closePane")}
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
              className="rounded p-1 text-fg-muted transition-colors hover:bg-border-strong hover:text-fg"
            >
              <SquareMinus size={14} />
            </button>
          </Tooltip>
        )}
      </div>
    </div>
  );
}
