import { useEffect, useRef, useState } from "react";
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
export function PaneWorktreeMenu({ cwd }: { cwd: string | undefined }) {
  const { t } = useTranslation("worktrees");
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const info = useWorktreeStore((s) => (cwd ? s.infos[cwd] : undefined));
  const openWorktrees = useUiStore((s) => s.openWorktrees);
  const hintSeen = useSettingsStore((s) => s.worktreeHintSeen);
  const setHintSeen = useSettingsStore((s) => s.setWorktreeHintSeen);

  useEffect(() => {
    if (!cwd) {
      return;
    }
    // The store dedups on its own staleness window, so a pane asking for a cwd
    // the cards already fetched costs nothing.
    void useWorktreeStore.getState().refresh([cwd]);
  }, [cwd]);

  // A linked worktree reports its main path; a plain repo is its own root.
  const repoPath = info ? (info.isWorktree ? info.mainPath : info.cwd) : null;
  if (!repoPath) {
    return null;
  }

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
      <Tooltip label={t("pane.paneMenu")} className="absolute right-7 top-1.5 z-10">
        <button
          ref={buttonRef}
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
          className="rounded bg-bg-inset/80 p-0.5 text-fg-subtle hover:bg-border-strong hover:text-fg"
        >
          <MoreHorizontal size={12} />
        </button>
      </Tooltip>

      {!hintSeen && (
        // Anchored to the button rather than a modal: it is pointing at a
        // control, and a dialog in the middle of the screen would have to
        // describe where to look instead of just being there.
        <div className="absolute right-1.5 top-8 z-20 w-64 rounded-lg border border-border bg-bg-elevated p-3 shadow-xl">
          <p className="text-xs font-semibold text-fg">{t("pane.hintTitle")}</p>
          <p className="mt-1 text-[11px] leading-relaxed text-fg-muted">{t("pane.hintBody")}</p>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setHintSeen(true);
            }}
            className="mt-2 rounded px-2 py-1 text-[11px] text-accent hover:bg-bg-inset"
          >
            {t("pane.hintDismiss")}
          </button>
        </div>
      )}

      {menu && <ContextMenu x={menu.x} y={menu.y} items={items} onClose={() => setMenu(null)} />}
    </>
  );
}
