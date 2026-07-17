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
      // Trail starting from nothing keeps the target's exact leading
      // separators: "/opt" stays rooted, a UNC path keeps its "\\\\" prefix,
      // and a Windows drive letter opens bare ("C:").
      const leading = target.match(/^[\\/]+/)?.[0] ?? "";
      current = `${leading}${segment}`;
    } else {
      current = `${current}${sep}${segment}`;
    }
    crumbs.push({ label: segment, path: current });
  }
  return crumbs;
}
