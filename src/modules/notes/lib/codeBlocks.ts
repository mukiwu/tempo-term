import type { NotesNode } from "./notesTree";

/**
 * Fenced code blocks harvested from notes, powering the status-bar quick
 * access (#263): every block a note holds is a paste-able command/prompt.
 * Extraction is pure string work so it stays unit-testable.
 */

/** Languages whose blocks are safe to paste-and-submit as shell commands.
 *  The empty string covers blocks with no language set. */
export const SHELL_LANGS = new Set(["", "sh", "bash", "zsh", "shell", "console", "terminal"]);

export interface QuickBlock {
  lang: string;
  text: string;
}

export interface NoteQuickBlocks {
  path: string;
  title: string;
  /** Folder path relative to the notes root ("" for top-level notes). */
  group: string;
  blocks: QuickBlock[];
}

/**
 * Extract fenced code blocks (``` fences at line start, as tiptap-markdown
 * writes them). Empty and unterminated blocks are skipped — a fence the user
 * is still typing should not surface half a note as a "command".
 */
export function extractCodeBlocks(markdown: string): QuickBlock[] {
  const blocks: QuickBlock[] = [];
  const lines = markdown.split("\n");
  let open: { lang: string; body: string[] } | null = null;
  for (const line of lines) {
    const fence = /^```(\S*)\s*$/.exec(line);
    if (open) {
      if (fence && fence[1] === "") {
        const text = open.body.join("\n");
        if (text.trim()) {
          blocks.push({ lang: open.lang, text });
        }
        open = null;
      } else {
        open.body.push(line);
      }
    } else if (fence) {
      open = { lang: fence[1].toLowerCase(), body: [] };
    }
  }
  return blocks;
}

/**
 * Walk the notes tree and read every note, returning the ones that contain at
 * least one code block, in tree order. A note that fails to read (deleted
 * mid-scan, cloud placeholder) is dropped rather than failing the whole scan.
 */
export async function collectQuickBlocks(
  nodes: NotesNode[],
  readNote: (path: string) => Promise<string>,
  group = "",
): Promise<NoteQuickBlocks[]> {
  const results: NoteQuickBlocks[] = [];
  for (const node of nodes) {
    if (node.kind === "folder") {
      const childGroup = group ? `${group} / ${node.name}` : node.name;
      results.push(...(await collectQuickBlocks(node.children, readNote, childGroup)));
    } else {
      const content = await readNote(node.path).catch(() => null);
      if (content === null) {
        continue;
      }
      const blocks = extractCodeBlocks(content);
      if (blocks.length > 0) {
        results.push({ path: node.path, title: node.title, group, blocks });
      }
    }
  }
  return results;
}
