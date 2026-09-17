import type { CommitNode } from "../types";

/**
 * Whether one commit matches the query. The single definition of "matches", so
 * the count in the toolbar and the mark on the row cannot disagree about it —
 * and the list of fields here is the list the row highlights, no more.
 */
export function commitMatches(commit: CommitNode, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") {
    return true;
  }
  return (
    commit.message.toLowerCase().includes(q) ||
    commit.author.toLowerCase().includes(q) ||
    commit.hash.toLowerCase().includes(q)
  );
}

/** Return the loaded commit indexes matching a case-insensitive query. */
export function findCommitMatchIndexes(commits: CommitNode[], query: string): number[] {
  return commits.flatMap((commit, index) => (commitMatches(commit, query) ? [index] : []));
}
