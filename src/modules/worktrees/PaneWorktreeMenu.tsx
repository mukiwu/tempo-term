import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { FolderGit2, MoreHorizontal, Plus } from "lucide-react";
import { ContextMenu, type ContextMenuItem } from "@/components/ContextMenu";
import { Tooltip } from "@/components/Tooltip";
import { useWorktreeStore } from "@/modules/workspace/lib/worktreeStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useUiStore } from "@/stores/uiStore";

/**
 * The worktree entry point on a terminal pane.
 *
 * Only appears when the pane is actually inside a git repo — a button offering
 * to branch a directory that git knows nothing about is a button that can only
 * disappoint. That answer comes from `worktreeStore`, which the workspace cards
 * already fill for every tab's cwd; a pane in a split that is not its tab's
 * active one is not in there, hence the refresh below.
 *
 * The badge in the status bar cannot introduce this feature, because it hides
 * itself until a worktree exists. This is where someone with none finds out
 * they can have one, so it carries the one-time hint.
 */
/**
 * The repo a pane's shell is in, or null when it is not in one.
 *
 * A hook rather than a check inside the menu, because the pane's whole control
 * cluster has to know whether this item exists before it decides to draw itself.
 */
export function usePaneRepoPath(cwd: string | undefined): string | null {
  const info = useWorktreeStore((s) => (cwd ? s.infos[cwd] : undefined));

  useEffect(() => {
    if (!cwd) {
      return;
    }
    // The store dedups on its own staleness window, so a pane asking for a cwd
    // the cards already fetched costs nothing.
    void useWorktreeStore.getState().refresh([cwd]);
  }, [cwd]);

  if (!info) {
    return null;
  }
  // A linked worktree reports its main path; a plain repo is its own root.
  return info.isWorktree ? info.mainPath : info.cwd;
}

export function PaneWorktreeMenu({ repoPath }: { repoPath: string }) {
  const { t } = useTranslation("worktrees");
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const openWorktrees = useUiStore((s) => s.openWorktrees);
  const hintSeen = useSettingsStore((s) => s.worktreeHintSeen);
  const setHintSeen = useSettingsStore((s) => s.setWorktreeHintSeen);

  const items: ContextMenuItem[] = [
    {
      id: "new-worktree",
      label: t("pane.newFromPane"),
      icon: Plus,
      group: 0,
      onSelect: () => openWorktrees("repo", repoPath, { creating: true }),
    },
    {
      id: "manage-worktrees",
      label: t("pane.manageFromPane"),
      icon: FolderGit2,
      group: 0,
      onSelect: () => openWorktrees("repo", repoPath),
    },
  ];

  return (
    <>
      <Tooltip label={t("pane.paneMenu")}>
        <button
          type="button"
          aria-label={t("pane.paneMenu")}
          onClick={(e) => {
            e.stopPropagation();
            const rect = e.currentTarget.getBoundingClientRect();
            // The menu flips itself back on-screen, so anchoring to the button's
            // bottom-right opens it leftward from a top-right button.
            setMenu({ x: rect.right, y: rect.bottom });
            if (!hintSeen) {
              setHintSeen(true);
            }
          }}
          className="rounded p-0.5 text-fg-subtle transition-colors hover:bg-border-strong hover:text-fg"
        >
          <MoreHorizontal size={12} />
        </button>
      </Tooltip>

      {!hintSeen && (
        // Anchored under the notch rather than centred as a dialog: it is
        // pointing at one control, and an arrow saying "this one" beats a
        // sentence describing where to look. Positioned against the pane, which
        // is the nearest positioned ancestor.
        <div className="absolute right-1 top-9 z-20 w-72 rounded-lg border border-border-strong bg-bg-elevated p-3 shadow-xl">
          <span
            aria-hidden
            className="absolute -top-[5px] right-[35px] h-2 w-2 rotate-45 border-l border-t border-border-strong bg-bg-elevated"
          />
          <p className="text-sm font-semibold text-fg">{t("pane.hintTitle")}</p>
          <p className="mt-1 text-sm leading-relaxed text-fg-muted">{t("pane.hintBody")}</p>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setHintSeen(true);
            }}
            className="mt-2 rounded py-1 text-sm text-accent transition-colors hover:text-fg"
          >
            {t("pane.hintDismiss")}
          </button>
        </div>
      )}

      {menu && <ContextMenu x={menu.x} y={menu.y} items={items} onClose={() => setMenu(null)} />}
    </>
  );
}
