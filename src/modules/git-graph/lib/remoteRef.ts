export interface SplitRemoteRef {
  /** The remote name, e.g. "origin". */
  remote: string;
  /** The branch name on the remote, e.g. "feat/notes-watcher" (may contain slashes). */
  branch: string;
}

/**
 * Split a remote-tracking ref like "origin/feat/notes-watcher" into its remote
 * and branch on the FIRST slash. The branch keeps any remaining slashes, which
 * is the common convention (the remote is the first path segment).
 */
export function splitRemoteRef(name: string): SplitRemoteRef {
  const slash = name.indexOf("/");
  if (slash === -1) {
    return { remote: name, branch: "" };
  }
  return { remote: name.slice(0, slash), branch: name.slice(slash + 1) };
}
