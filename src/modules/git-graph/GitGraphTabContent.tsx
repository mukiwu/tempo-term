import { useCallback, useEffect, useRef, useState } from "react";
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
import { Resizer } from "@/components/Resizer";
import { gitResolveRepo } from "@/modules/source-control/lib/gitBridge";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { GitGraph, type GitGraphLabels } from "./GitGraph";
import { CommitInputModal, type InputField } from "./CommitInputModal";
import { CommitDetailsPanel, type CommitDetailsLabels } from "./CommitDetailsPanel";
import {
  gitBranchCheckout,
  gitBranchCreateAt,
  gitBranchDelete,
  gitBranches,
  gitCherryPick,
  gitFetch,
  gitGraphLog,
  gitMerge,
  gitReset,
  gitRevert,
  gitTagCreate,
  gitTagDelete,
} from "./lib/gitGraphBridge";
import { GitGraphToolbar, type GitGraphToolbarLabels } from "./GitGraphToolbar";
import { filterCommits } from "./lib/filterCommits";
import { withMinDuration } from "@/lib/withMinDuration";
import type { Branch, CommitNode, CommitRef, GraphOptions } from "./types";

const PAGE_SIZE = 200;
// Local git reloads finish almost instantly; keep the busy spinner up at least
// this long so the refresh feedback is actually perceptible.
const MIN_BUSY_MS = 400;

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
  const [detailsHeight, setDetailsHeight] = useState<number>(() => {
    const v = Number(localStorage.getItem("tempoterm-gitgraph-details-height"));
    return Number.isFinite(v) && v > 0 ? v : 280;
  });
  const detailsHeightRef = useRef(detailsHeight);
  detailsHeightRef.current = detailsHeight;
  const [menu, setMenu] = useState<MenuTarget | null>(null);
  const [modal, setModal] = useState<ModalState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);
  const [includeRemotes, setIncludeRemotes] = useState(true);
  const [includeTags, setIncludeTags] = useState(true);
  const [includeStashes, setIncludeStashes] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [fetching, setFetching] = useState(false);
  // Any action that reloads the graph (refresh button + context-menu git ops)
  // flips this so the refresh icon spins while the reload is in flight.
  const [busy, setBusy] = useState(false);

  const options: GraphOptions = {
    branch: selectedBranch,
    includeRemotes,
    includeTags,
    includeStashes,
  };

  const visibleCommits = filterCommits(commits, searchQuery);

  const currentBranch = branches.find((b) => b.isCurrent)?.name ?? "—";

  const reload = useCallback(
    async (repoPath: string, nextLimit: number, opts: GraphOptions) => {
      try {
        const [log, branchList] = await Promise.all([
          gitGraphLog(repoPath, nextLimit, opts),
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

  // Resolve the repo from the workspace root.
  useEffect(() => {
    if (!rootPath) {
      setResolved(true);
      setRepo(null);
      return;
    }
    let cancelled = false;
    setResolved(false);
    gitResolveRepo(rootPath)
      .then((resolvedRepo) => {
        if (cancelled) {
          return;
        }
        setRepo(resolvedRepo);
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
  }, [rootPath]);

  // Initial load, and reload whenever a display option changes.
  useEffect(() => {
    if (!repo) {
      return;
    }
    setLimit(PAGE_SIZE);
    void reload(repo, PAGE_SIZE, {
      branch: selectedBranch,
      includeRemotes,
      includeTags,
      includeStashes,
    });
  }, [repo, selectedBranch, includeRemotes, includeTags, includeStashes, reload]);

  // Run an action then refresh the graph; surface any failure inline.
  const runAction = useCallback(
    async (action: () => Promise<void>) => {
      if (!repo) {
        return;
      }
      setError(null);
      setBusy(true);
      try {
        await withMinDuration(
          (async () => {
            await action();
            await reload(repo, limit, options);
          })(),
          MIN_BUSY_MS,
        );
      } catch (err: unknown) {
        setError(getErrorMessage(err));
      } finally {
        setBusy(false);
      }
    },
    [repo, limit, reload, options.branch, options.includeRemotes, options.includeTags, options.includeStashes],
  );

  const loadMore = useCallback(() => {
    if (!repo) {
      return;
    }
    const next = limit + PAGE_SIZE;
    setLimit(next);
    void reload(repo, next, options);
  }, [repo, limit, reload, options.branch, options.includeRemotes, options.includeTags, options.includeStashes]);

  // Turning remotes off hides remote branches; if one was selected, fall back
  // to Show All so the dropdown value and selectedBranch stay in sync.
  const handleToggleRemotes = useCallback(
    (value: boolean) => {
      setIncludeRemotes(value);
      if (!value) {
        const current = branches.find((b) => b.name === selectedBranch);
        if (current?.isRemote) {
          setSelectedBranch(null);
        }
      }
    },
    [branches, selectedBranch],
  );

  const handleFetch = useCallback(async () => {
    if (!repo) {
      return;
    }
    setError(null);
    setFetching(true);
    try {
      await gitFetch(repo);
      await reload(repo, limit, options);
    } catch (err: unknown) {
      setError(getErrorMessage(err));
    } finally {
      setFetching(false);
    }
  }, [repo, limit, reload, options.branch, options.includeRemotes, options.includeTags, options.includeStashes]);

  const toolbarLabels: GitGraphToolbarLabels = {
    branches: t("toolbar.branches"),
    showAll: t("toolbar.showAll"),
    showRemoteBranches: t("toolbar.showRemoteBranches"),
    search: t("toolbar.search"),
    searchPlaceholder: t("toolbar.searchPlaceholder"),
    displayOptions: t("toolbar.displayOptions"),
    showTags: t("toolbar.showTags"),
    showStashes: t("toolbar.showStashes"),
    refresh: t("toolbar.refresh"),
    fetch: t("toolbar.fetch"),
    fetching: t("toolbar.fetching"),
    matches: t("toolbar.matches"),
    head: t("toolbar.head"),
    more: t("toolbar.more"),
  };

  const persistDetailsHeight = useCallback(() => {
    localStorage.setItem(
      "tempoterm-gitgraph-details-height",
      String(detailsHeightRef.current),
    );
  }, []);

  const labels: GitGraphLabels = {
    emptyTitle: t("empty.title"),
    emptyHint: t("empty.hint"),
    loadMore: t("loadMore"),
    refHint: t("refHint"),
  };

  const detailsLabels: CommitDetailsLabels = {
    author: t("details.author"),
    date: t("details.date"),
    changedFiles: t("details.changedFiles"),
    noChanges: t("details.noChanges"),
    noDiff: t("details.noDiff"),
    noFileSelected: t("details.noFileSelected"),
    close: t("details.close"),
    diffTab: t("details.diffTab"),
    aiTab: t("details.aiTab"),
    aiGenerate: t("details.aiGenerate"),
    aiExplaining: t("details.aiExplaining"),
    aiRegenerate: t("details.aiRegenerate"),
    aiNeedKey: t("details.aiNeedKey"),
    aiEmpty: t("details.aiEmpty"),
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

      <div className="mb-2">
        <GitGraphToolbar
          branches={branches}
          selectedBranch={selectedBranch}
          onSelectBranch={setSelectedBranch}
          includeRemotes={includeRemotes}
          onToggleRemotes={handleToggleRemotes}
          includeTags={includeTags}
          onToggleTags={setIncludeTags}
          includeStashes={includeStashes}
          onToggleStashes={setIncludeStashes}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          matchCount={visibleCommits.length}
          onRefresh={() => void runAction(async () => {})}
          onFetch={() => void handleFetch()}
          fetching={fetching}
          refreshing={busy}
          currentBranch={currentBranch}
          labels={toolbarLabels}
        />
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1">
          <GitGraph
            commits={visibleCommits}
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
        {selected && repo && (
          <>
            <Resizer
              orientation="horizontal"
              onResize={(delta) =>
                setDetailsHeight((h) => Math.min(700, Math.max(120, h - delta)))
              }
              onResizeEnd={persistDetailsHeight}
            />
            <div style={{ height: `${detailsHeight}px` }} className="shrink-0">
              <CommitDetailsPanel
                repo={repo}
                commit={selected}
                onClose={() => setSelected(null)}
                labels={detailsLabels}
              />
            </div>
          </>
        )}
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
