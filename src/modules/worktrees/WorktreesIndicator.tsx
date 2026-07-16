import { FolderGit2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Tooltip } from "@/components/Tooltip";
import { useUiStore } from "@/stores/uiStore";
import { selectTotalWorktrees, useWorktreeRegistryStore } from "@/stores/worktreeRegistryStore";

/**
 * StatusBar badge showing how many worktrees exist across every repo known to
 * have one. Clicking it opens the manager on everything.
 *
 * The count is ambient on purpose: creating a worktree is one click and each one
 * carries its own `node_modules`, so without a number sitting in view they
 * accumulate invisibly until the disk is full. Reads cached per-repo counts from
 * the registry — never scans to render.
 */
export function WorktreesIndicator() {
  const { t } = useTranslation("worktrees");
  const openWorktrees = useUiStore((s) => s.openWorktrees);
  const total = useWorktreeRegistryStore(selectTotalWorktrees);
  const repoNames = useWorktreeRegistryStore((s) =>
    Object.keys(s.byRepo)
      .map((path) => path.split(/[/\\]/).filter(Boolean).pop() ?? path)
      .join(", "),
  );

  // Nothing to keep an eye on: stay out of the status bar entirely, like Ports.
  if (total === 0) {
    return null;
  }

  return (
    // Names the repos rather than their total size: measuring that means walking
    // every worktree, which is not something a tooltip should trigger.
    <Tooltip label={`${t("badge", { count: total })} · ${repoNames}`} side="top">
      <button
        type="button"
        aria-label={t("badge", { count: total })}
        onClick={() => openWorktrees("global")}
        className="flex h-5 items-center gap-1 rounded px-1.5 text-fg-subtle transition-colors hover:text-fg"
      >
        <FolderGit2 size={14} strokeWidth={1.75} />
        <span className="text-xs">{total}</span>
      </button>
    </Tooltip>
  );
}
