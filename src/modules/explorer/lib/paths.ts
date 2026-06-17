/**
 * Small, OS-path string helpers for the explorer. These operate on the
 * absolute paths the Rust side returns (forward slashes on macOS/Linux,
 * backslashes on Windows) without importing Node's `path`, which is not
 * available in the WebView.
 */

/** Match a run of either slash flavour, so the helpers work on both platforms. */
const SEPARATORS = /[\\/]+/;

/** Whichever separator the path itself uses, defaulting to "/". */
function separatorOf(path: string): string {
  return path.includes("\\") && !path.includes("/") ? "\\" : "/";
}

/** The final path segment ("/a/b/c.txt" -> "c.txt"), ignoring trailing slashes. */
export function basename(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const segments = trimmed.split(SEPARATORS);
  const last = segments[segments.length - 1];
  return last && last.length > 0 ? last : path;
}

/** The parent directory ("/a/b/c.txt" -> "/a/b"). Roots return themselves. */
export function dirname(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const index = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  if (index <= 0) {
    // No separator, or the only one is the leading root slash.
    return index === 0 ? trimmed.slice(0, 1) : trimmed;
  }
  return trimmed.slice(0, index);
}

/** Join a directory and a child segment with the directory's own separator. */
export function joinPath(dir: string, child: string): string {
  const sep = separatorOf(dir);
  const base = dir.replace(/[\\/]+$/, "");
  const leaf = child.replace(/^[\\/]+/, "");
  return `${base}${sep}${leaf}`;
}

/**
 * Express `path` relative to `root`. When `path` sits inside `root` the common
 * prefix (and the separator after it) is stripped; otherwise the original
 * absolute path is returned unchanged.
 */
export function relativePath(path: string, root: string): string {
  const normalizedRoot = root.replace(/[\\/]+$/, "");
  if (path === normalizedRoot) {
    return basename(path);
  }
  if (path.startsWith(`${normalizedRoot}/`) || path.startsWith(`${normalizedRoot}\\`)) {
    return path.slice(normalizedRoot.length).replace(/^[\\/]+/, "");
  }
  return path;
}
