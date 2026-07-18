import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { extractHeadings } from "./noteToc";

/** A headless editor over StarterKit, enough to build real ProseMirror docs. */
function docFrom(content: object): Editor {
  return new Editor({
    element: document.createElement("div"),
    extensions: [StarterKit],
    content,
  });
}

function heading(level: number, text: string): object {
  return { type: "heading", attrs: { level }, content: [{ type: "text", text }] };
}

describe("extractHeadings", () => {
  it("lists headings in document order with level, text, and position", () => {
    const editor = docFrom({
      type: "doc",
      content: [
        heading(1, "Title"),
        { type: "paragraph", content: [{ type: "text", text: "body" }] },
        heading(2, "Section"),
        heading(3, "Detail"),
      ],
    });

    const headings = extractHeadings(editor.state.doc);

    expect(headings.map((h) => [h.level, h.text])).toEqual([
      [1, "Title"],
      [2, "Section"],
      [3, "Detail"],
    ]);
    // Positions point at the heading nodes so a click can select them; they
    // must be strictly increasing and within the doc.
    const positions = headings.map((h) => h.pos);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(positions.every((p) => p >= 0 && p < editor.state.doc.content.size)).toBe(true);
  });

  it("returns empty for a doc with no headings", () => {
    const editor = docFrom({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "just text" }] }],
    });
    expect(extractHeadings(editor.state.doc)).toEqual([]);
  });

  it("flattens inline marks into plain text", () => {
    const editor = docFrom({
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 2 },
          content: [
            { type: "text", text: "with " },
            { type: "text", marks: [{ type: "code" }], text: "code" },
          ],
        },
      ],
    });
    expect(extractHeadings(editor.state.doc).map((h) => h.text)).toEqual(["with code"]);
  });
});
