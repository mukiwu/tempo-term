import { useTranslation } from "react-i18next";
import { Plus, SplitSquareHorizontal, SplitSquareVertical, X } from "lucide-react";
import { TerminalView } from "./TerminalView";
import { computeLayout } from "./lib/terminalLayout";
import { useTabsStore, type TerminalTab } from "@/stores/tabsStore";

export function TerminalTabContent({ tab }: { tab: TerminalTab }) {
  const { t } = useTranslation();
  const splitActivePane = useTabsStore((s) => s.splitActivePane);
  const setActiveLeaf = useTabsStore((s) => s.setActiveLeaf);
  const closePane = useTabsStore((s) => s.closePane);

  const panes = computeLayout(tab.paneTree);
  const multiple = panes.length > 1;

  return (
    <div className="flex h-full flex-col bg-bg-inset">
      <div className="flex h-7 shrink-0 items-center justify-end gap-0.5 border-b border-border px-2">
        <button
          type="button"
          title={t("workspace.newTerminal")}
          aria-label={t("workspace.newTerminal")}
          onClick={() => splitActivePane("row")}
          className="rounded p-1 text-fg-muted hover:bg-bg-elevated hover:text-fg"
        >
          <Plus size={14} />
        </button>
        <button
          type="button"
          title={t("workspace.splitRight")}
          aria-label={t("workspace.splitRight")}
          onClick={() => splitActivePane("row")}
          className="rounded p-1 text-fg-muted hover:bg-bg-elevated hover:text-fg"
        >
          <SplitSquareHorizontal size={14} />
        </button>
        <button
          type="button"
          title={t("workspace.splitDown")}
          aria-label={t("workspace.splitDown")}
          onClick={() => splitActivePane("col")}
          className="rounded p-1 text-fg-muted hover:bg-bg-elevated hover:text-fg"
        >
          <SplitSquareVertical size={14} />
        </button>
      </div>

      <div className="relative min-h-0 flex-1">
        {panes.map((pane) => {
          const active = pane.id === tab.activeLeafId;
          return (
            <div
              key={pane.id}
              onMouseDown={() => setActiveLeaf(tab.id, pane.id)}
              style={{
                position: "absolute",
                left: `${pane.rect.left}%`,
                top: `${pane.rect.top}%`,
                width: `${pane.rect.width}%`,
                height: `${pane.rect.height}%`,
              }}
              className={`p-1 ${multiple ? "border border-border" : ""} ${
                active && multiple ? "border-accent" : ""
              }`}
            >
              {multiple && (
                <button
                  type="button"
                  aria-label={t("workspace.closePane")}
                  title={t("workspace.closePane")}
                  onClick={(e) => {
                    e.stopPropagation();
                    closePane(tab.id, pane.id);
                  }}
                  className="absolute right-1.5 top-1.5 z-10 rounded bg-bg-inset/80 p-0.5 text-fg-subtle hover:bg-border-strong hover:text-fg"
                >
                  <X size={12} />
                </button>
              )}
              <TerminalView active={active} onExit={() => closePane(tab.id, pane.id)} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
