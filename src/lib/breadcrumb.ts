/**
 * Builds the breadcrumb trail a pane header shows for a path.
 *
 * Root rules (see docs/adr and CONTEXT.md "Breadcrumb"): under home the trail
 * is home-relative (the home prefix omitted, home itself shown as "~");
 * outside home the absolute path is shown in full. Deliberately NOT
 * workspace-relative: the workspace root follows the focused terminal's cwd,
 * so trails anchored to it re-rooted themselves on every focus change.
 */

export interface Crumb {
  /** The segment's display name. */
  label: string;
  /** The absolute path this segment stands for (menu + cd target). */
  path: string;
}

export interface CrumbRoots {
  homeDir?: string | null;
}

/** Match a run of either slash flavour, so Windows paths work too. */
const SEPARATORS = /[\\/]+/;

/** Matches a Windows drive designator and nothing else: "C:", "D:". */
const DRIVE = /^[A-Za-z]:$/;

/**
 * A path a crumb can stand on. A bare "C:" cannot: on Windows it means the
 * *current directory* on drive C:, which is per-drive process state, so only
 * "C:\" names the root. Everything else is already a location and passes
 * through untouched.
 */
function rooted(path: string, sep: string): string {
  return DRIVE.test(path) ? `${path}${sep}` : path;
}

function trimTrailing(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  return trimmed.length > 0 ? trimmed : path;
}

function isInside(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`) || path.startsWith(`${root}\\`);
}

/**
 * The separator the path itself uses, defaulting to "/". A leading drive
 * designator counts as a Windows path even before any separator shows up, so
 * "C:" on its own still resolves to "\" rather than the default.
 */
function separatorOf(path: string): string {
  if (path.includes("/")) {
    return "/";
  }
  // slice(0, 2) is the drive head of "C:\Windows", or the whole of "C:".
  return path.includes("\\") || DRIVE.test(path.slice(0, 2)) ? "\\" : "/";
}

export function buildCrumbs(path: string, roots: CrumbRoots): Crumb[] {
  const target = trimTrailing(path);
  const sep = separatorOf(target);

  const homeDir = roots.homeDir ? trimTrailing(roots.homeDir) : null;
  if (homeDir && isInside(target, homeDir)) {
    // Home itself would otherwise be an empty trail; "~" keeps it visible
    // (and clickable) without spelling out the home prefix anywhere else.
    if (target === homeDir) {
      return [{ label: "~", path: rooted(homeDir, sep) }];
    }
    return crumbsBelow(homeDir, target, sep);
  }

  // Outside every known root: the full absolute path, one crumb per segment.
  return crumbsBelow("", target, sep);
}

/** One crumb per segment of `target` below `root` (none when they are equal). */
function crumbsBelow(root: string, target: string, sep: string): Crumb[] {
  const rest = target.slice(root.length).replace(/^[\\/]+/, "");
  const crumbs: Crumb[] = [];
  let current = root;
  for (const segment of rest.length > 0 ? rest.split(SEPARATORS) : []) {
    if (current.length === 0) {
      // Trail starting from nothing keeps the target's exact leading
      // separators: "/opt" stays rooted and a UNC path keeps its "\\\\" prefix.
      const leading = target.match(/^[\\/]+/)?.[0] ?? "";
      current = `${leading}${segment}`;
    } else {
      current = `${current}${sep}${segment}`;
    }
    // `rooted` goes on the crumb the user clicks, not on the accumulator, so
    // the next segment still joins as "C:\Windows", not "C:\\Windows".
    crumbs.push({ label: segment, path: rooted(current, sep) });
  }
  return crumbs;
}
