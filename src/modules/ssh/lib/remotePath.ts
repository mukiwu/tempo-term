const SCHEME = "ssh://";

/** Build `ssh://<connectionId>/<path>`; ensures the path has a leading slash. */
export function buildRemoteUri(connectionId: string, path: string): string {
  const clean = path.startsWith("/") ? path : `/${path}`;
  return `${SCHEME}${connectionId}${clean}`;
}

/** True when a path string is a remote SFTP uri rather than a local path. */
export function isRemoteUri(value: string): boolean {
  return value.startsWith(SCHEME);
}

/** Split a remote uri into its connection id and remote path, or null if local. */
export function parseRemoteUri(
  uri: string,
): { connectionId: string; path: string } | null {
  if (!uri.startsWith(SCHEME)) {
    return null;
  }
  const rest = uri.slice(SCHEME.length);
  const slash = rest.indexOf("/");
  if (slash === -1) {
    return { connectionId: rest, path: "/" };
  }
  return { connectionId: rest.slice(0, slash), path: rest.slice(slash) };
}
