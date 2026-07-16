/**
 * Builds the breadcrumb trail a pane header shows for a path.
 *
 * Root rules (see docs/adr and CONTEXT.md "Breadcrumb"): inside the workspace
 * the trail starts at the workspace root's own name; outside it falls back to
 * home-relative; outside home the absolute path is shown in full.
 */

export interface Crumb {
  /** The segment's display name. */
  label: string;
  /** The absolute path this segment stands for (menu + cd target). */
  path: string;
}

export interface CrumbRoots {
  workspaceRoot?: string | null;
  homeDir?: string | null;
}

/** Match a run of either slash flavour, so Windows paths work too. */
const SEPARATORS = /[\\/]+/;

function trimTrailing(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  return trimmed.length > 0 ? trimmed : path;
}

function isInside(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`) || path.startsWith(`${root}\\`);
}

/** The separator the path itself uses, defaulting to "/". */
function separatorOf(path: string): string {
  return path.includes("\\") && !path.includes("/") ? "\\" : "/";
}

export function buildCrumbs(path: string, roots: CrumbRoots): Crumb[] {
  const target = trimTrailing(path);
  const sep = separatorOf(target);
  const workspaceRoot = roots.workspaceRoot ? trimTrailing(roots.workspaceRoot) : null;

  if (workspaceRoot && isInside(target, workspaceRoot)) {
    return [{ label: lastSegment(workspaceRoot), path: workspaceRoot }, ...crumbsBelow(workspaceRoot, target, sep)];
  }

  const homeDir = roots.homeDir ? trimTrailing(roots.homeDir) : null;
  if (homeDir && isInside(target, homeDir)) {
    // Home itself would otherwise be an empty trail; "~" keeps it visible
    // (and clickable) without spelling out the home prefix anywhere else.
    if (target === homeDir) {
      return [{ label: "~", path: homeDir }];
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
      // Trail starting from nothing: a POSIX absolute path keeps its leading
      // slash ("/opt"), a Windows drive letter opens bare ("C:").
      current = target.startsWith(sep) ? `${sep}${segment}` : segment;
    } else {
      current = `${current}${sep}${segment}`;
    }
    crumbs.push({ label: segment, path: current });
  }
  return crumbs;
}

function lastSegment(path: string): string {
  const segments = trimTrailing(path).split(SEPARATORS);
  const last = segments[segments.length - 1];
  return last && last.length > 0 ? last : path;
}
