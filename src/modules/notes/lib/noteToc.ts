import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

export interface NoteHeading {
  level: number;
  text: string;
  /** ProseMirror position of the heading node, for selection and scrolling. */
  pos: number;
}

/**
 * Every heading in `doc`, in document order. Pure over the ProseMirror doc so
 * the TOC panel can recompute on open without subscribing to editor updates.
 */
export function extractHeadings(doc: ProseMirrorNode): NoteHeading[] {
  const headings: NoteHeading[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === "heading") {
      headings.push({ level: node.attrs.level as number, text: node.textContent, pos });
    }
  });
  return headings;
}
