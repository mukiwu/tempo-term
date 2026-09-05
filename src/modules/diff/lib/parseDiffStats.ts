/**
 * Per-file numbers read out of one `git diff`, for describing a file before
 * its editors exist: the +/- counts in a section header, the row estimate a
 * placeholder reserves, and the hunk positions cross-file change navigation
 * steps through.
 *
 * The concatenated view never feeds this diff text to an editor — the
 * comparison itself is built from two full documents, the same way the
 * single-file tab does it. This is only the scan.
 */

/** Where one hunk sits, and how tall it reads. */
export interface DiffHunk {
  /** 1-based first line of the hunk in the new document. */
  line: number;
  /** Rows the hunk takes on screen: the wider of its two sides. */
  size: number;
}

export interface FileDiffStats {
  added: number;
  deleted: number;
  /** git called the file binary, so it has no lines to show. */
  binary: boolean;
  hunks: DiffHunk[];
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * Unquote a path git wrote with `core.quotePath` on. Only the quotes and the
 * C-style escapes git actually emits are handled; an octal escape is left as
 * written, which at worst means the lookup misses and the section falls back
 * to counting the documents it loaded.
 */
function unquote(path: string): string {
  if (!path.startsWith('"') || !path.endsWith('"')) {
    return path;
  }
  return path
    .slice(1, -1)
    .replace(/\\t/g, "\t")
    .replace(/\\n/g, "\n")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

/** Drop the a/ or b/ git puts in front of a path, quotes stripped first. */
function stripSide(target: string, side: "a/" | "b/"): string {
  const bare = unquote(target);
  return bare.startsWith(side) ? bare.slice(2) : bare;
}

/**
 * The new-side path out of a `diff --git a/x b/x` header. Both halves carry
 * the same name for everything but a rename, and a path holding " b/" would
 * fool the split — but this is only the provisional key, overwritten by the
 * file's own `+++ b/` line whenever the diff has one (everything except a
 * binary file).
 */
function headerPath(line: string): string | null {
  const rest = line.slice("diff --git ".length);
  const split = Math.max(rest.lastIndexOf(' "b/'), rest.lastIndexOf(" b/"));
  if (split < 0) {
    return null;
  }
  return stripSide(rest.slice(split + 1).trim(), "b/");
}

/**
 * Split one `git diff` into per-file stats, keyed by repo-relative path with
 * git's forward slashes — the same shape `gitStatus` reports, so the two line
 * up without translation.
 *
 * A deleted file is keyed by its old path (its new side is /dev/null), which
 * is also what git status calls it.
 */
export function parseDiffStats(diff: string): Map<string, FileDiffStats> {
  const files = new Map<string, FileDiffStats>();
  let path: string | null = null;
  let stats: FileDiffStats | null = null;
  // Inside a hunk body every line starts with "+", "-", " " or "\", and
  // anything else ends it. Without that rule a diff of a diff derails the
  // parse: a deleted "-- x" line reads as a "--- " file header, and an added
  // "iff --git ..." line as the start of another file.
  let inHunk = false;

  const flush = () => {
    if (path && stats) {
      files.set(path, stats);
    }
  };

  for (const line of diff.split("\n")) {
    if (inHunk && stats && /^[+\-\\ ]/.test(line)) {
      if (line.startsWith("+")) {
        stats.added += 1;
      } else if (line.startsWith("-")) {
        stats.deleted += 1;
      }
      continue;
    }
    const hunk = HUNK.exec(line);
    if (hunk && stats) {
      // A pure insertion or deletion reports 0 for the other side; the row it
      // takes is still at least one.
      const oldCount = hunk[2] === undefined ? 1 : Number(hunk[2]);
      const newCount = hunk[4] === undefined ? 1 : Number(hunk[4]);
      stats.hunks.push({
        line: Math.max(1, Number(hunk[3])),
        size: Math.max(1, oldCount, newCount),
      });
      inHunk = true;
      continue;
    }
    inHunk = false;
    if (line.startsWith("diff --git ")) {
      flush();
      path = headerPath(line);
      stats = { added: 0, deleted: 0, binary: false, hunks: [] };
      continue;
    }
    if (!stats) {
      continue;
    }
    // The ---/+++ pair names the file authoritatively; /dev/null means the
    // file only exists on the other side, so that side keeps the name.
    if (line.startsWith("+++ ")) {
      const target = line.slice(4).trim();
      if (target !== "/dev/null") {
        path = stripSide(target, "b/");
      }
      continue;
    }
    if (line.startsWith("--- ")) {
      const target = line.slice(4).trim();
      if (target === "/dev/null") {
        continue;
      }
      // Only used when the new side turns out to be /dev/null; the +++ line
      // below overwrites it otherwise.
      path = stripSide(target, "a/");
      continue;
    }
    if (line.startsWith("Binary files ") || line.startsWith("GIT binary patch")) {
      stats.binary = true;
    }
  }
  flush();
  return files;
}

/**
 * Rows a collapsed comparison of this file is expected to render: every hunk
 * at its own height (git's three context lines either side already overlap
 * what `collapseUnchanged` keeps), plus one row per collapsed stretch between
 * and around them.
 *
 * Only accurate enough to reserve a placeholder — the real height replaces it
 * the moment the file mounts.
 */
export function estimatedRows(stats: FileDiffStats): number {
  if (stats.binary) {
    return 0;
  }
  const hunks = stats.hunks.reduce((rows, hunk) => rows + hunk.size, 0);
  return hunks + stats.hunks.length + 1;
}

/** Changed lines, the measure the truncation rule reads. */
export function changedLines(stats: FileDiffStats): number {
  return stats.added + stats.deleted;
}
