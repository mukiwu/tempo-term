import type { CommitNode } from "../types";

/** Return the loaded commit indexes matching a case-insensitive query. */
export function findCommitMatchIndexes(commits: CommitNode[], query: string): number[] {
  const q = query.trim().toLowerCase();
  if (q === "") {
    return commits.map((_, index) => index);
  }
  return commits.flatMap((commit, index) =>
    commit.message.toLowerCase().includes(q) ||
    commit.author.toLowerCase().includes(q) ||
    commit.hash.toLowerCase().includes(q)
      ? [index]
      : [],
  );
}
