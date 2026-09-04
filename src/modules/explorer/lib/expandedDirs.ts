/**
 * Which folders the file explorer had open, remembered per workspace root.
 *
 * The tree's expanded state used to live only in each TreeNode's local
 * `useState`, so it died with the component: switching to a tab on another
 * root re-roots the explorer, which unmounts every node, and switching back
 * remounted them all collapsed. These helpers back the store that survives
 * that unmount so the tree comes back the way the user left it.
 *
 * Kept as pure functions over a plain `Record<root, path[]>` (rather than a
 * Set) so the shape persists as JSON as-is, and so the capping rules below
 * are unit-testable without a store.
 */
export type ExpandedDirs = Record<string, string[]>;

/**
 * Roots to remember at once. Each entry is a folder the user opened at some
 * point; past this many the least recently touched one is dropped rather than
 * letting the persisted blob grow for the life of the install.
 */
export const MAX_ROOTS = 20;

/**
 * Folders remembered per root. Expand All on a large repo can open a lot of
 * them at once; this bounds a single root's share of localStorage. The oldest
 * paths go first, so the folders the user opened most recently — the ones they
 * are actually working in — are the ones that survive.
 */
export const MAX_DIRS_PER_ROOT = 500;

/** Whether `path` was left expanded under `root`. */
export function isDirRemembered(
  map: ExpandedDirs,
  root: string | null,
  path: string,
): boolean {
  if (!root) {
    return false;
  }
  return map[root]?.includes(path) ?? false;
}

/**
 * Records `path` as expanded under `root`, moving it to the end (most recent)
 * if it was already there. Returns `map` unchanged when it is already the last
 * entry, so a redundant write cannot trigger a re-persist.
 */
export function rememberDir(map: ExpandedDirs, root: string | null, path: string): ExpandedDirs {
  if (!root) {
    return map;
  }
  const current = map[root] ?? [];
  if (current[current.length - 1] === path) {
    return map;
  }
  const paths = current.filter((p) => p !== path);
  paths.push(path);
  return capRoots({ ...map, [root]: paths.slice(-MAX_DIRS_PER_ROOT) }, root);
}

/** Drops `path` from `root`'s remembered set (the user collapsed it). */
export function forgetDir(map: ExpandedDirs, root: string | null, path: string): ExpandedDirs {
  if (!root) {
    return map;
  }
  const current = map[root];
  if (!current || !current.includes(path)) {
    return map;
  }
  return { ...map, [root]: current.filter((p) => p !== path) };
}

/** Forgets everything under `root` (collapse-all, or a refresh). */
export function forgetRoot(map: ExpandedDirs, root: string | null): ExpandedDirs {
  if (!root || !(root in map)) {
    return map;
  }
  const next = { ...map };
  delete next[root];
  return next;
}

/**
 * Trims the map down to {@link MAX_ROOTS}, always keeping `keep` (the root
 * just written to) and dropping from the front — object key order is insertion
 * order for these string keys, so the front is the root opened longest ago.
 */
function capRoots(map: ExpandedDirs, keep: string): ExpandedDirs {
  const roots = Object.keys(map);
  if (roots.length <= MAX_ROOTS) {
    return map;
  }
  const kept = roots.filter((root) => root !== keep).slice(-(MAX_ROOTS - 1));
  const next: ExpandedDirs = {};
  for (const root of kept) {
    next[root] = map[root];
  }
  next[keep] = map[keep];
  return next;
}
