/** A ref decoration attached to a commit (branch / tag / HEAD / remote / stash). */
export interface CommitRef {
  name: string;
  /** "head" | "branch" | "tag" | "remote" | "stash" | "unknown" */
  kind: string;
}

/** One node of the commit DAG rendered by the Git graph. */
export interface CommitNode {
  hash: string;
  parents: string[];
  author: string;
  date: string;
  message: string;
  refs: CommitRef[];
}

/** A page of graph commits plus whether more history exists past `commits`. */
export interface GraphLog {
  commits: CommitNode[];
  hasMore: boolean;
}

/** A local or remote branch entry. */
export interface Branch {
  name: string;
  isCurrent: boolean;
  isRemote: boolean;
}

/**
 * Commit ordering for the graph. "date" interleaves branches chronologically
 * (more parallel lanes, matches VSCode's default); "topo" groups each branch's
 * commits together (fewer lanes).
 */
export type CommitOrder = "date" | "topo";

/** Display options sent to the backend graph log. `branch` null means Show All. */
export interface GraphOptions {
  branch: string | null;
  includeRemotes: boolean;
  includeTags: boolean;
  includeStashes: boolean;
  order: CommitOrder;
}

/** One file changed by a commit. */
export interface CommitFileChange {
  status: string;
  path: string;
}

/** A commit's full message plus its changed files. */
export interface CommitDetails {
  message: string;
  files: CommitFileChange[];
}

/** One parsed line of a unified diff for rendering. */
export interface DiffLine {
  kind: "file" | "hunk" | "add" | "del" | "context" | "meta";
  text: string;
}
