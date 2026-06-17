import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  GitBranch,
  GitCommit,
  GitMerge,
  RotateCcw,
  Tag,
  Trash2,
  Undo2,
} from "lucide-react";
import { ContextMenu, type ContextMenuItem } from "@/components/ContextMenu";
import { gitResolveRepo } from "@/modules/source-control/lib/gitBridge";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { GitGraph, type GitGraphLabels } from "./GitGraph";
import { CommitInputModal, type InputField } from "./CommitInputModal";
import {
  gitBranchCheckout,
  gitBranchCreateAt,
  gitBranchDelete,
  gitBranches,
  gitCherryPick,
  gitGraphLog,
  gitMerge,
  gitReset,
  gitRevert,
  gitTagCreate,
  gitTagDelete,
} from "./lib/gitGraphBridge";
import type { Branch, CommitNode, CommitRef } from "./types";

const PAGE_SIZE = 200;

type MenuTarget =
  | { type: "commit"; commit: CommitNode; x: number; y: number }
  | { type: "ref"; ref: CommitRef; x: number; y: number };

interface ModalState {
  title: string;
  fields: InputField[];
  confirmLabel: string;
  onConfirm: (values: Record<string, string>) => void;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "Unexpected error";
}

export function GitGraphTabContent() {
  const { t } = useTranslation("gitGraph");
  const rootPath = useWorkspaceStore((s) => s.rootPath);

  const [repo, setRepo] = useState<string | null>(null);
  const [resolved, setResolved] = useState(false);
  const [commits, setCommits] = useState<CommitNode[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [selected, setSelected] = useState<CommitNode | null>(null);
  const [menu, setMenu] = useState<MenuTarget | null>(null);
  const [modal, setModal] = useState<ModalState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const currentBranch = branches.find((b) => b.isCurrent)?.name ?? "—";

  const reload = useCallback(
    async (repoPath: string, nextLimit: number) => {
      try {
        const [log, branchList] = await Promise.all([
          gitGraphLog(repoPath, nextLimit),
          gitBranches(repoPath),
        ]);
        setCommits(log.commits);
        setHasMore(log.hasMore);
        setBranches(branchList);
      } catch (err: unknown) {
        setCommits([]);
        setBranches([]);
        setHasMore(false);
        setError(getErrorMessage(err));
      }
    },
    [],
  );

  // Resolve the repo from the workspace root, then load the first page.
  useEffect(() => {
    if (!rootPath) {
      setResolved(true);
      setRepo(null);
      return;
    }
    let cancelled = false;
    setResolved(false);
    gitResolveRepo(rootPath)
      .then(async (resolvedRepo) => {
        if (cancelled) {
          return;
        }
        setRepo(resolvedRepo);
        if (resolvedRepo) {
          setLimit(PAGE_SIZE);
          await reload(resolvedRepo, PAGE_SIZE);
        }
        setResolved(true);
      })
      .catch(() => {
        if (!cancelled) {
          setRepo(null);
          setResolved(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [rootPath, reload]);

  // Run an action then refresh the graph; surface any failure inline.
  const runAction = useCallback(
    async (action: () => Promise<void>) => {
      if (!repo) {
        return;
      }
      setError(null);
      try {
        await action();
        await reload(repo, limit);
      } catch (err: unknown) {
        setError(getErrorMessage(err));
      }
    },
    [repo, limit, reload],
  );

  const loadMore = useCallback(() => {
    if (!repo) {
      return;
    }
    const next = limit + PAGE_SIZE;
    setLimit(next);
    void reload(repo, next);
  }, [repo, limit, reload]);

  const labels: GitGraphLabels = {
    title: t("title"),
    emptyTitle: t("empty.title"),
    emptyHint: t("empty.hint"),
    loadMore: t("loadMore"),
    commits: t("commits"),
    refHint: t("refHint"),
  };

  // Build the right-click menu for a commit node.
  const commitMenuItems = (commit: CommitNode): ContextMenuItem[] => [
    {
      id: "branchHere",
      label: t("menu.createBranchHere"),
      icon: GitBranch,
      group: 0,
      onSelect: () =>
        setModal({
          title: t("modal.createBranch.title"),
          confirmLabel: t("modal.createBranch.confirm"),
          fields: [
            {
              key: "name",
              label: t("modal.branchName"),
              placeholder: t("modal.branchPlaceholder"),
              required: true,
            },
          ],
          onConfirm: (values) =>
            void runAction(() => gitBranchCreateAt(repo!, values.name, commit.hash)),
        }),
    },
    {
      id: "tagHere",
      label: t("menu.createTagHere"),
      icon: Tag,
      group: 0,
      onSelect: () =>
        setModal({
          title: t("modal.createTag.title"),
          confirmLabel: t("modal.createTag.confirm"),
          fields: [
            {
              key: "name",
              label: t("modal.tagName"),
              placeholder: t("modal.tagPlaceholder"),
              required: true,
            },
            {
              key: "message",
              label: t("modal.tagMessage"),
              placeholder: t("modal.tagMessagePlaceholder"),
              multiline: true,
            },
          ],
          onConfirm: (values) =>
            void runAction(() =>
              gitTagCreate(repo!, values.name, commit.hash, values.message),
            ),
        }),
    },
    {
      id: "cherryPick",
      label: t("menu.cherryPick"),
      icon: GitCommit,
      group: 1,
      onSelect: () => void runAction(() => gitCherryPick(repo!, commit.hash)),
    },
    {
      id: "revert",
      label: t("menu.revert"),
      icon: Undo2,
      group: 1,
      onSelect: () => void runAction(() => gitRevert(repo!, commit.hash)),
    },
    {
      id: "resetSoft",
      label: t("menu.resetSoft"),
      icon: RotateCcw,
      group: 2,
      onSelect: () => void runAction(() => gitReset(repo!, commit.hash, "soft")),
    },
    {
      id: "resetHard",
      label: t("menu.resetHard"),
      icon: RotateCcw,
      group: 2,
      danger: true,
      onSelect: () => void runAction(() => gitReset(repo!, commit.hash, "hard")),
    },
  ];

  // Build the right-click menu for a branch / tag / HEAD decoration.
  const refMenuItems = (ref: CommitRef): ContextMenuItem[] => {
    if (ref.kind === "tag") {
      return [
        {
          id: "deleteTag",
          label: t("menu.deleteTag"),
          icon: Trash2,
          group: 0,
          danger: true,
          onSelect: () => void runAction(() => gitTagDelete(repo!, ref.name)),
        },
      ];
    }
    // head = current branch (no checkout/merge of itself), branch = other local.
    const items: ContextMenuItem[] = [];
    if (ref.kind === "branch") {
      items.push(
        {
          id: "checkout",
          label: t("menu.checkout"),
          icon: GitBranch,
          group: 0,
          onSelect: () => void runAction(() => gitBranchCheckout(repo!, ref.name)),
        },
        {
          id: "merge",
          label: t("menu.merge", { name: ref.name }),
          icon: GitMerge,
          group: 0,
          onSelect: () => void runAction(() => gitMerge(repo!, ref.name)),
        },
        {
          id: "deleteBranch",
          label: t("menu.deleteBranch"),
          icon: Trash2,
          group: 1,
          danger: true,
          onSelect: () =>
            void runAction(() => gitBranchDelete(repo!, ref.name, true)),
        },
      );
    }
    return items;
  };

  if (resolved && !repo) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-fg-subtle">
        <GitCommit size={40} strokeWidth={1} />
        <p className="text-sm">{t("noRepo")}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-bg p-3">
      {error && (
        <div className="mb-2 flex items-center justify-between rounded border border-danger/40 bg-danger/10 px-3 py-1.5 text-xs text-danger">
          <span className="truncate">{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="ml-2 shrink-0 font-mono text-[11px] underline"
          >
            {t("dismiss")}
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1">
        <GitGraph
          commits={commits}
          currentBranch={currentBranch}
          selectedCommit={selected}
          onSelectCommit={setSelected}
          onCommitContextMenu={(commit, x, y) =>
            setMenu({ type: "commit", commit, x, y })
          }
          onRefContextMenu={(ref, x, y) => setMenu({ type: "ref", ref, x, y })}
          hasMore={hasMore}
          onLoadMore={loadMore}
          labels={labels}
        />
      </div>

      {menu &&
        (() => {
          const items =
            menu.type === "commit"
              ? commitMenuItems(menu.commit)
              : refMenuItems(menu.ref);
          // The current branch (kind "head") has no applicable actions; skip the
          // menu rather than flashing an empty one.
          if (items.length === 0) {
            return null;
          }
          return (
            <ContextMenu
              x={menu.x}
              y={menu.y}
              items={items}
              onClose={() => setMenu(null)}
            />
          );
        })()}

      {modal && (
        <CommitInputModal
          open
          title={modal.title}
          fields={modal.fields}
          confirmLabel={modal.confirmLabel}
          cancelLabel={t("modal.cancel")}
          onConfirm={(values) => {
            modal.onConfirm(values);
            setModal(null);
          }}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
