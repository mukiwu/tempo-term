/**
 * Small, OS-path string helpers for the explorer. These operate on the
 * absolute paths the Rust side returns (forward slashes on macOS/Linux,
 * backslashes on Windows) without importing Node's `path`, which is not
 * available in the WebView.
 */

/** Match a run of either slash flavour, so the helpers work on both platforms. */
const SEPARATORS = /[\\/]+/;

/** Matches a Windows drive designator and nothing else: "C:", "D:". */
const DRIVE = /^[A-Za-z]:$/;

/**
 * Whichever separator the path itself uses, defaulting to "/". A leading drive
 * designator counts as a Windows path even before any separator shows up, so
 * "C:" on its own still resolves to "\". Kept in step with the same-named
 * helper in `@/lib/breadcrumb` — two path helpers answering this differently
 * is worse than the duplication.
 */
function separatorOf(path: string): string {
  if (path.includes("/")) {
    return "/";
  }
  // slice(0, 2) is the drive head of "C:\Windows", or the whole of "C:".
  return path.includes("\\") || DRIVE.test(path.slice(0, 2)) ? "\\" : "/";
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
  const parent = trimmed.slice(0, index);
  // "C:\file.txt" sits at the root of drive C:, and the root only keeps that
  // meaning with its separator — a bare "C:" means the drive's *current
  // directory* instead, which is per-drive process state.
  return DRIVE.test(parent) ? `${parent}${trimmed.charAt(index)}` : parent;
}

/** Join a directory and a child segment with the directory's own separator. */
export function joinPath(dir: string, child: string): string {
  const sep = separatorOf(dir);
  const base = dir.replace(/[\\/]+$/, "");
  const leaf = child.replace(/^[\\/]+/, "");
  return `${base}${sep}${leaf}`;
}

/**
 * The parent segment of an already-relative path (as returned by
 * `relativePath`), or "" when the entry has no directory component (it sits
 * directly at the root). Used by the file search results list to show the
 * folder a match lives in alongside its name.
 */
export function relativeDirOf(relative: string): string {
  const name = basename(relative);
  return relative.length > name.length ? relative.slice(0, relative.length - name.length - 1) : "";
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
