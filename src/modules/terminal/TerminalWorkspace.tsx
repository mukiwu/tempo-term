import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Plus, SplitSquareHorizontal, SplitSquareVertical, X } from "lucide-react";
import { TerminalView } from "./TerminalView";
import { computeLayout } from "./lib/terminalLayout";
import { useTerminalSplitStore } from "./store/terminalSplitStore";

export function TerminalWorkspace() {
  const { t } = useTranslation();
  const root = useTerminalSplitStore((s) => s.root);
  const activeLeafId = useTerminalSplitStore((s) => s.activeLeafId);
  const ensureInitial = useTerminalSplitStore((s) => s.ensureInitial);
  const splitActive = useTerminalSplitStore((s) => s.splitActive);
  const closeLeaf = useTerminalSplitStore((s) => s.closeLeaf);
  const setActive = useTerminalSplitStore((s) => s.setActive);

  // Open the first pane once. ensureInitial is idempotent, so React StrictMode's
  // double-mount in dev does not create a second one.
  useEffect(() => {
    ensureInitial();
  }, [ensureInitial]);

  const panes = root ? computeLayout(root) : [];
  const multiple = panes.length > 1;

  return (
    <div className="flex h-full flex-col bg-bg-inset">
      <div className="flex h-8 shrink-0 items-center gap-0.5 border-b border-border px-2">
        <span className="mr-auto font-mono text-[11px] font-bold uppercase tracking-wider text-fg-subtle">
          {t("workspace.terminal")}
        </span>
        <button
          type="button"
          title={t("workspace.newTerminal")}
          aria-label={t("workspace.newTerminal")}
          onClick={() => splitActive("row")}
          className="rounded p-1 text-fg-muted hover:bg-bg-elevated hover:text-fg"
        >
          <Plus size={15} />
        </button>
        <button
          type="button"
          title={t("workspace.splitRight")}
          aria-label={t("workspace.splitRight")}
          onClick={() => splitActive("row")}
          className="rounded p-1 text-fg-muted hover:bg-bg-elevated hover:text-fg"
        >
          <SplitSquareHorizontal size={15} />
        </button>
        <button
          type="button"
          title={t("workspace.splitDown")}
          aria-label={t("workspace.splitDown")}
          onClick={() => splitActive("col")}
          className="rounded p-1 text-fg-muted hover:bg-bg-elevated hover:text-fg"
        >
          <SplitSquareVertical size={15} />
        </button>
      </div>

      <div className="relative min-h-0 flex-1">
        {panes.map((pane) => {
          const active = pane.id === activeLeafId;
          return (
            <div
              key={pane.id}
              onMouseDown={() => setActive(pane.id)}
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
                    closeLeaf(pane.id);
                  }}
                  className="absolute right-1.5 top-1.5 z-10 rounded bg-bg-inset/80 p-0.5 text-fg-subtle hover:bg-border-strong hover:text-fg"
                >
                  <X size={12} />
                </button>
              )}
              <TerminalView active={active} onExit={() => closeLeaf(pane.id)} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
