import { diffHeaderPath } from "@/lib/gitPath";
import type { DiffLine } from "../types";

/**
 * Pull one file's section out of a multi-file unified diff.
 *
 * `git_diff` answers for a whole side of the working tree at once — there is no
 * per-file working-tree diff command, and the details panel renders parsed
 * unified-diff text rather than the two file contents the diff *tab* compares.
 * So the file is cut out here instead of asking git again per row.
 *
 * Returns "" when the file has no section, which is the honest answer for a
 * path git reports as changed on the other side (staged vs unstaged) or for an
 * untracked file — `git diff` never mentions those. See `untrackedDiffLines`.
 */
export function sliceFileDiff(diff: string, path: string): string {
  if (diff === "" || path === "") {
    return "";
  }
  const lines = diff.split("\n");
  // git writes the header as `diff --git a/<old> b/<new>`. Match on the b-side
  // so a rename is found under the name the caller knows it by, and read that
  // side through the same unquoting the rest of the app uses: `git_diff` shells
  // out to git, which escapes a non-ASCII path under `core.quotePath`, while
  // the caller's path came from libgit2 and is raw UTF-8. Comparing the two
  // literally matches nothing for every CJK filename there is — and here
  // nothing reads as "this file has no changes on this side".
  //
  // A trailing \r is tolerated. git terminates its own header lines with \n, so
  // this should not arise from `git_diff` — but a header that misses by one
  // invisible byte returns nothing, and nothing is indistinguishable from "this
  // file genuinely has no changes on this side". Not worth leaving a silently
  // empty panel to that.
  const withoutCr = (line: string): string =>
    line.endsWith("\r") ? line.slice(0, -1) : line;
  const isHeaderFor = (line: string): boolean => {
    const bare = withoutCr(line);
    return bare.startsWith("diff --git ") && diffHeaderPath(bare) === path;
  };

  const start = lines.findIndex(isHeaderFor);
  if (start === -1) {
    return "";
  }
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith("diff --git ")) {
      end = i;
      break;
    }
  }
  const section = lines.slice(start, end).join("\n");
  return section === "" ? "" : `${section}\n`;
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
