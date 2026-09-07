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

/**
 * What the Git Graph commit list currently has selected: one commit, two
 * commits being compared, or the working tree. `from`/`to` are ordered
 * older/newer by list position, not by click order.
 *
 * The working-tree variant carries nothing. It has no hash to identify it by,
 * and giving it a payload (the head it sits on, its file counts) would freeze
 * a copy that goes stale the moment the graph reloads. Everything the panel
 * needs about the working tree arrives as props, freshly fetched; this stays a
 * plain answer to "what is selected", which is also why it survives a reload
 * that no longer finds any particular hash.
 */
export type GraphSelection =
  | { mode: "single"; commit: CommitNode }
  | { mode: "compare"; from: CommitNode; to: CommitNode }
  | { mode: "workspace" };

/**
 * How much is uncommitted, for the graph's top row. Counts only — the row shows
 * "staged 3 · unstaged 4" and nothing that would need the paths themselves.
 */
export interface UncommittedSummary {
  staged: number;
  unstaged: number;
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
  /** Unix seconds of the branch tip's committer time; 0 when unresolvable. */
  lastCommitAt: number;
}

/**
 * Commit ordering for the graph. "date" interleaves branches chronologically
 * (more parallel lanes, matches VSCode's default); "topo" groups each branch's
 * commits together (fewer lanes).
 */
export type CommitOrder = "date" | "topo";

/** Display options sent to the backend graph log. Empty `branches` means Show All. */
export interface GraphOptions {
  branches: string[];
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
