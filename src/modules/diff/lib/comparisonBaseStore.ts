import { create } from "zustand";
import { useTabsStore } from "@/stores/tabsStore";

/**
 * What the all-changes page is comparing against, kept per repository and only
 * for as long as the app is running.
 *
 * Per repository because a base is a ref name: `upstream/main` means nothing in
 * the next folder you open, and a range of hashes means even less. Keyed on the
 * path `gitResolveRepo` returns rather than on the workspace root, since two
 * roots inside one repo are the same repo and must share an answer, and two
 * worktrees of one repo share refs but not a working tree and must not.
 *
 * Not persisted, which is what #398 settled: a base chosen three days ago is
 * more confusing than no base at all. It also keeps a stale ref from outliving
 * the session that made sense of it.
 *
 * Only refs are remembered. A one-off range is the state of the page looking at
 * it, not a standing preference -- and the commits in it can be rebased away
 * inside a single session, so remembering one buys a broken base later.
 */
export type ComparisonBaseValue =
  /** The working tree: what #397 shows, and where every repo starts. */
  | { kind: "worktree" }
  /** A branch or tag, compared from where it and HEAD diverged. */
  | { kind: "ref"; name: string }
  /**
   * Two named points, compared literally. Neither end is on disk, so this is
   * two-dot -- what actually differs between the two trees, not what one of
   * them added since they parted.
   */
  | { kind: "range"; from: string; to: string };

export const WORKTREE: ComparisonBaseValue = { kind: "worktree" };

interface ComparisonBaseState {
  /** repo path -> what that repo is being compared against. */
  byRepo: Record<string, ComparisonBaseValue>;
  /** Whether uncommitted work is folded into the comparison. Ignored while the
   * base is the working tree, which is uncommitted work by definition. */
  includeUncommitted: boolean;
  setBase: (repo: string, base: ComparisonBaseValue) => void;
  setIncludeUncommitted: (on: boolean) => void;
  /** Drop a repo's base after the ref behind it has gone. */
  clear: (repo: string) => void;
}

export const useComparisonBaseStore = create<ComparisonBaseState>((set) => ({
  byRepo: {},
  includeUncommitted: true,
  setBase: (repo, base) =>
    set((state) => ({ byRepo: { ...state.byRepo, [repo]: base } })),
  setIncludeUncommitted: (on) => set({ includeUncommitted: on }),
  clear: (repo) =>
    set((state) => {
      if (!(repo in state.byRepo)) {
        return state;
      }
      const byRepo = { ...state.byRepo };
      delete byRepo[repo];
      return { byRepo };
    }),
}));

/** The base for `repo`, defaulting to the working tree. */
export function baseFor(
  byRepo: Record<string, ComparisonBaseValue>,
  repo: string | null,
): ComparisonBaseValue {
  return (repo && byRepo[repo]) || WORKTREE;
}

/**
 * Read a comparison on the all-changes page: set the base, then bring the page
 * up.
 *
 * One function because there are several ways in -- the graph's details panel,
 * the Source Control panel's recent commits -- and they were each doing the
 * two steps themselves. The order matters and the second step is easy to
 * forget: the page is a singleton, so a tab that already exists is focused
 * rather than built, and focusing one still holding the last base would show
 * the wrong comparison under the right heading.
 *
 * Both ends are named outright rather than one of them being written `X^`,
 * which is the same range but reads as an expression the reader has to
 * evaluate -- and `47c9cee^..47c9cee` is two near-identical strings where two
 * different hashes would say at a glance what is being compared. Every caller
 * already holds the parent: each one checks for it to decide whether to offer
 * the button at all, since a root commit has no other end.
 */
export function readComparison(repo: string, from: string, to: string): void {
  useComparisonBaseStore.getState().setBase(repo, { kind: "range", from, to });
  useTabsStore.getState().openAllChangesTab();
}

/**
 * Read the working tree on the all-changes page: drop whatever base the repo
 * was on, then bring the page up.
 *
 * The sibling of `readComparison` for the one selection that is not a
 * comparison at all. Dropping the base is the whole point -- the page is a
 * singleton, so a tab still holding the last range would answer the graph's
 * working-tree row with someone else's commits.
 */
export function readWorkingTree(repo: string): void {
  useComparisonBaseStore.getState().clear(repo);
  useTabsStore.getState().openAllChangesTab();
}
