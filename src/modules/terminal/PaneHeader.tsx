import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { Tooltip } from "@/components/Tooltip";
import { PaneWorktreeMenu, usePaneRepoPath } from "@/modules/worktrees/PaneWorktreeMenu";

function basename(path: string): string {
  return path.split(/[/\\]/).filter(Boolean).pop() ?? path;
}

/**
 * A terminal pane's header: what it is, and what you can do to it.
 *
 * Same shape as `EditorToolbar` — `h-7`, a bottom border, name on the left,
 * actions on the right — because an editor pane already had one and a terminal
 * pane did not, so its controls floated over its own output instead. Two
 * control languages in one pane is one too many.
 *
 * It also gives a terminal somewhere to say which directory it is in. Until now
 * the only way to tell was that the shell's prompt happened to mention it.
 */
export function PaneHeader({
  cwd,
  isTerminal,
  showClose,
  onClose,
}: {
  cwd: string | undefined;
  /** Only a local terminal has a worktree menu: an SSH pane's shell is on
   *  another machine, where a local worktree means nothing. */
  isTerminal: boolean;
  showClose: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const repoPath = usePaneRepoPath(isTerminal ? cwd : undefined);

  return (
    <div className="flex h-7 shrink-0 items-center justify-between gap-2 border-b border-border pl-2 pr-1">
      {cwd ? (
        <Tooltip label={cwd} className="min-w-0">
          <span className="min-w-0 truncate text-xs text-fg-muted">{basename(cwd)}</span>
        </Tooltip>
      ) : (
        <span />
      )}
      <div className="flex shrink-0 items-center gap-0.5">
        {repoPath && <PaneWorktreeMenu repoPath={repoPath} />}
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
