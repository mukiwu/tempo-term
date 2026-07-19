import type { DiffComment } from "./diffCommentStore";

/**
 * Format a batch of diff comments as one prompt for a CLI agent. Comments are
 * grouped by file and ordered by line; the captured line text anchors each
 * remark so the agent can locate it even if line numbers drifted. English
 * framing — the comment bodies themselves stay verbatim.
 */
export function formatCommentPrompt(comments: DiffComment[]): string {
  const byPath = new Map<string, DiffComment[]>();
  for (const comment of comments) {
    const list = byPath.get(comment.path) ?? [];
    list.push(comment);
    byPath.set(comment.path, list);
  }
  const sections = [...byPath.entries()].map(([path, list]) => {
    const lines = list
      .slice()
      .sort((x, y) => x.line - y.line)
      .map((c) => {
        const where =
          c.side === "a" ? `Line ${c.line} (old version)` : `Line ${c.line}`;
        const anchor = c.lineText.trim();
        const head = anchor ? `- ${where}, \`${anchor}\`:` : `- ${where}:`;
        // Keep multi-line comment bodies intact, indented under their bullet.
        const body = c.body
          .split("\n")
          .map((row) => `  ${row}`)
          .join("\n");
        return `${head}\n${body}`;
      });
    return `## ${path}\n${lines.join("\n")}`;
  });
  return `Please address the following review comments on the current uncommitted changes:\n\n${sections.join("\n\n")}\n`;
}

/**
 * Re-anchor comments after a diff document reloads: a comment whose captured
 * line text no longer matches its line number gets moved to the nearest line
 * with the same text. Comments that still match (or whose text is nowhere to
 * be found) are left alone. Returns only the comments that moved.
 */
export function reanchorComments(
  comments: DiffComment[],
  docLines: string[],
): { id: string; line: number }[] {
  const updates: { id: string; line: number }[] = [];
  for (const comment of comments) {
    const at = docLines[comment.line - 1];
    if (at === comment.lineText) {
      continue;
    }
    // A blank line matches everywhere, so "nearest match" would drift the
    // comment to an unrelated block — better to leave it where it was.
    if (!comment.lineText.trim()) {
      continue;
    }
    let nearest: number | null = null;
    for (let i = 0; i < docLines.length; i++) {
      if (docLines[i] !== comment.lineText) {
        continue;
      }
      const line = i + 1;
      if (nearest === null || Math.abs(line - comment.line) < Math.abs(nearest - comment.line)) {
        nearest = line;
      }
    }
    if (nearest !== null && nearest !== comment.line) {
      updates.push({ id: comment.id, line: nearest });
    }
  }
  return updates;
}
