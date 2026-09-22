import type { CommitNode } from "../types";

/**
 * The fields a search reads, and so the fields a row marks — no more. Takes the
 * query already trimmed and lowercased, because the caller looping over history
 * would otherwise redo that for every commit on every keystroke.
 */
function matchesNeedle(commit: CommitNode, needle: string): boolean {
  return (
    commit.message.toLowerCase().includes(needle) ||
    commit.author.toLowerCase().includes(needle) ||
    commit.hash.toLowerCase().includes(needle)
  );
}

/**
 * Whether one commit matches the query. The single definition of "matches", so
 * the count in the toolbar and the mark on the row cannot disagree about it.
 *
 * An empty query matches everything, which is the answer the counter wants and
 * a trap for anything asking "is this row a match": see the click handler in
 * GitGraphTabContent, which has to check for a running search separately.
 */
export function commitMatches(commit: CommitNode, query: string): boolean {
  const needle = query.trim().toLowerCase();
  return needle === "" || matchesNeedle(commit, needle);
}

/** Return the loaded commit indexes matching a case-insensitive query. */
export function findCommitMatchIndexes(commits: CommitNode[], query: string): number[] {
  const needle = query.trim().toLowerCase();
  // Every commit matches, and this runs on every keystroke over however much
  // history is loaded — going through the predicate would allocate a
  // one-element array per commit for an answer that is just "all of them".
  if (needle === "") {
    return commits.map((_, index) => index);
  }
  return commits.flatMap((commit, index) => (matchesNeedle(commit, needle) ? [index] : []));
}
