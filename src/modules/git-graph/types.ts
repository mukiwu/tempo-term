/** A ref decoration attached to a commit (branch / tag / HEAD / remote). */
export interface CommitRef {
  name: string;
  /** "head" | "branch" | "tag" | "remote" | "unknown" */
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

/** A local branch entry. */
export interface Branch {
  name: string;
  isCurrent: boolean;
}
