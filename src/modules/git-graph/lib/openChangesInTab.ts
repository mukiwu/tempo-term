import {
  readComparison,
  readWorkingTree,
} from "@/modules/diff/lib/comparisonBaseStore";
import type { GraphSelection } from "../types";

/**
 * What the details panel's "open in a tab" button does for a selection, or
 * nothing when there is no diff to read.
 *
 * A single commit reads as the range from its parent, which is what "the
 * changes in this commit" means -- so a root commit, having no parent to
 * compare against, is the one selection that offers nothing. The working-tree
 * row is not a comparison at all: it opens the page on the working tree, which
 * is what that row is showing a summary of.
 */
export function openChangesInTab(
  repo: string | null,
  selection: GraphSelection,
): (() => void) | undefined {
  if (!repo) {
    return undefined;
  }
  if (selection.mode === "workspace") {
    return () => readWorkingTree(repo);
  }
  if (selection.mode === "compare") {
    return () => readComparison(repo, selection.from.hash, selection.to.hash);
  }
  if (selection.commit.parents.length > 0) {
    return () => readComparison(repo, selection.commit.hash);
  }
  return undefined;
}
