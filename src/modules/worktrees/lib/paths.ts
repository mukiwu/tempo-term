import { IS_WINDOWS } from "@/lib/platform";

/**
 * A path in one comparable form: separators unified, trailing slashes dropped,
 * and case folded on Windows, where the filesystem is case-insensitive and the
 * pty's spelling of a path need not match git's.
 */
function normalize(path: string, windows: boolean): string {
  const unified = path.replace(/\\/g, "/");
  const trimmed = unified.replace(/\/+$/, "");
  // "/" and "//" trim away to nothing, but the filesystem root is a real
  // directory rather than an empty path — collapsing it would make `isUnder`
  // reject everything beneath it.
  const rooted = trimmed === "" && unified.startsWith("/") ? "/" : trimmed;
  return windows ? rooted.toLowerCase() : rooted;
}

/**
 * Whether `child` is `parent` itself, or sits inside it.
 *
 * Deliberately not a bare `startsWith`: this feature parks worktrees in a
 * `<repo>-worktrees/` sibling of the repo, so a prefix test would report every
 * worktree as living inside the repo it came from — silently mis-attributing
 * agent status and making "focus the existing tab" open the wrong one. The
 * boundary has to fall on a separator.
 *
 * `windows` is a parameter rather than a direct `IS_WINDOWS` read so both
 * platforms' behavior is covered by tests on either machine.
 */
export function isUnder(child: string, parent: string, windows: boolean = IS_WINDOWS): boolean {
  const from = normalize(child, windows);
  const root = normalize(parent, windows);
  if (!from || !root) {
    return false;
  }
  if (from === root) {
    return true;
  }
  // A root that already ends in its separator ("/" itself, or a drive root)
  // must not get a second one appended, or the prefix becomes unmatchable.
  const prefix = root.endsWith("/") ? root : `${root}/`;
  return from.startsWith(prefix);
}
