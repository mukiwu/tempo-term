import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { NoteToc } from "./NoteToc";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

function editorWith(content: object): Editor {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return new Editor({ element: el, extensions: [StarterKit], content });
}

const DOC = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Intro" }] },
    { type: "paragraph", content: [{ type: "text", text: "body" }] },
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Usage" }] },
  ],
};

describe("NoteToc", () => {
  it("renders nothing without an editor", () => {
    const { container } = render(<NoteToc editor={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("opens a panel listing the note's headings", () => {
    const editor = editorWith(DOC);
    render(<NoteToc editor={editor} />);

    fireEvent.click(screen.getByRole("button", { name: "toc" }));

    expect(screen.getByRole("button", { name: "Intro" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Usage" })).toBeInTheDocument();
  });

  it("shows the empty hint when the note has no headings", () => {
    const editor = editorWith({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "plain" }] }],
    });
    render(<NoteToc editor={editor} />);

    fireEvent.click(screen.getByRole("button", { name: "toc" }));

    expect(screen.getByText("tocEmpty")).toBeInTheDocument();
  });

  it("clicking a heading moves the selection onto it, scrolls it, and closes the panel", () => {
    const editor = editorWith(DOC);
    // The spy replaces the no-op stub the test setup installs on
    // HTMLElement.prototype (jsdom itself has no scrollIntoView), and locks in
    // that nodeDOM(pos) really resolves a heading's DOM element — the scroll
    // can only fire when it did.
    const scrollSpy = vi.fn();
    const proto = HTMLElement.prototype;
    const original = proto.scrollIntoView;
    proto.scrollIntoView = scrollSpy;
    try {
      render(<NoteToc editor={editor} />);

      fireEvent.click(screen.getByRole("button", { name: "toc" }));
      fireEvent.click(screen.getByRole("button", { name: "Usage" }));

      // The "Usage" heading starts after Intro (h1) and the paragraph.
      const { from } = editor.state.selection;
      expect(editor.state.doc.resolve(from).parent.textContent).toBe("Usage");
      expect(scrollSpy).toHaveBeenCalledWith({ block: "start" });
      expect(screen.queryByRole("button", { name: "Usage" })).not.toBeInTheDocument();
    } finally {
      proto.scrollIntoView = original;
    }
  });

  it("recomputes headings on each open", () => {
    const editor = editorWith(DOC);
    render(<NoteToc editor={editor} />);

    fireEvent.click(screen.getByRole("button", { name: "toc" }));
    expect(screen.getByRole("button", { name: "Intro" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "toc" }));

    // Append a heading, reopen: the new one must appear.
    editor
      .chain()
      .insertContentAt(editor.state.doc.content.size, {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "Fresh" }],
      })
      .run();
    fireEvent.click(screen.getByRole("button", { name: "toc" }));
    expect(screen.getByRole("button", { name: "Fresh" })).toBeInTheDocument();
  });
});
