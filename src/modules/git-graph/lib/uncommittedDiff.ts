import { diffHeaderPath, stripGitPathSide } from "@/lib/gitPath";
import type { DiffLine } from "../types";

/**
 * A trailing \r is tolerated throughout. git terminates its own header lines
 * with \n, so this should not arise from `git_diff` — but a header that misses
 * by one invisible byte yields nothing, and nothing is indistinguishable from
 * "this file genuinely has no changes on this side". Not worth leaving a
 * silently empty panel to that.
 */
const withoutCr = (line: string): string => (line.endsWith("\r") ? line.slice(0, -1) : line);

/**
 * The path one section belongs to, read the way the rest of the app reads it.
 *
 * The `diff --git a/x b/x` header is only provisional: its two halves are
 * separated by " b/" and a path may contain that. The file's own `+++ b/` line
 * is unambiguous, so prefer it, and fall back to the a-side for a deleted file
 * (whose new side is /dev/null) — which is the name `git status` uses too.
 *
 * Only the lines before the first hunk are read, so a `+++` inside a hunk body
 * cannot be mistaken for the header. A binary file has neither and keeps the
 * header's answer.
 */
function sectionPath(lines: readonly string[], start: number, end: number): string | null {
  let fromOldSide: string | null = null;
  for (let i = start + 1; i < end; i++) {
    const line = withoutCr(lines[i]);
    if (line.startsWith("@@ ")) {
      break;
    }
    if (line.startsWith("+++ ")) {
      const target = line.slice(4).trim();
      if (target !== "/dev/null") {
        return stripGitPathSide(target, "b/");
      }
      break;
    }
    if (line.startsWith("--- ")) {
      const target = line.slice(4).trim();
      if (target !== "/dev/null") {
        fromOldSide = stripGitPathSide(target, "a/");
      }
    }
  }
  return fromOldSide ?? diffHeaderPath(withoutCr(lines[start]));
}

/**
 * Cut a multi-file unified diff into one section per file, keyed by the path
 * `git status` reports the file under.
 *
 * `git_diff` answers for a whole side of the working tree at once — there is no
 * per-file working-tree diff command, and the details panel renders parsed
 * unified-diff text rather than the two file contents the diff *tab* compares.
 * So the files are cut out here instead of asking git again per row.
 *
 * Splitting the whole answer at once, rather than scanning it again for each
 * file the reader clicks, is what keeps a large repository cheap: the caller
 * holds this map for as long as the status it came from is current.
 */
export function splitFileDiffs(diff: string): Map<string, string> {
  const sections = new Map<string, string>();
  if (diff === "") {
    return sections;
  }
  const lines = diff.split("\n");
  const starts: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (withoutCr(lines[i]).startsWith("diff --git ")) {
      starts.push(i);
    }
  }
  for (let s = 0; s < starts.length; s++) {
    const start = starts[s];
    const end = s + 1 < starts.length ? starts[s + 1] : lines.length;
    const path = sectionPath(lines, start, end);
    // First section wins: a well-formed diff names each file once, and taking
    // the first keeps this identical to reading the diff top to bottom.
    if (path === null || path === "" || sections.has(path)) {
      continue;
    }
    const section = lines.slice(start, end).join("\n");
    if (section !== "") {
      sections.set(path, `${section}\n`);
    }
  }
  return sections;
}

/**
 * One file's section out of a multi-file unified diff.
 *
 * Returns "" when the file has no section, which is the honest answer for a
 * path git reports as changed on the other side (staged vs unstaged) or for an
 * untracked file — `git diff` never mentions those. See `untrackedDiffLines`.
 *
 * Reading more than one file out of the same diff should go through
 * `splitFileDiffs` and keep the map, rather than calling this once per file.
 */
export function sliceFileDiff(diff: string, path: string): string {
  if (diff === "" || path === "") {
    return "";
  }
  return splitFileDiffs(diff).get(path) ?? "";
}

/**
 * Build an all-additions diff for a file git will not diff at all.
 *
 * An untracked file is absent from `git diff` output, so slicing gives nothing
 * and the panel would say "no difference" for the single most common case there
 * is — a file you just created. Its whole content *is* the change, so render it
 * as one added hunk rather than showing the reader an empty panel.
 */
export function untrackedDiffLines(path: string, contents: string): DiffLine[] {
  const body = contents.endsWith("\n") ? contents.slice(0, -1) : contents;
  const rows = body === "" ? [] : body.split("\n");
  return [
    { kind: "meta", text: `diff --git a/${path} b/${path}` },
    { kind: "meta", text: "new file" },
    { kind: "hunk", text: `@@ -0,0 +1,${rows.length} @@` },
    ...rows.map((text): DiffLine => ({ kind: "add", text: `+${text}` })),
  ];
}
