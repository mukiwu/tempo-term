import { createRef } from "react";
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
    vi.useFakeTimers();
    try {
      render(<NoteToc editor={editor} />);

      fireEvent.click(screen.getByRole("button", { name: "toc" }));
      fireEvent.click(screen.getByRole("button", { name: "Usage" }));

      // The "Usage" heading starts after Intro (h1) and the paragraph.
      const { from } = editor.state.selection;
      expect(editor.state.doc.resolve(from).parent.textContent).toBe("Usage");
      // The scroll is deferred a tick (behind the webview's caret-reveal);
      // it must not have fired synchronously.
      expect(scrollSpy).not.toHaveBeenCalled();
      vi.advanceTimersByTime(0);
      expect(scrollSpy).toHaveBeenCalledWith({ block: "start" });
      // The landing heading flashes so the destination is visible even when
      // the scroll couldn't top-align it (end of document).
      const flashed = document.querySelector(".note-toc-flash");
      expect(flashed?.textContent).toBe("Usage");
      vi.advanceTimersByTime(2000);
      expect(document.querySelector(".note-toc-flash")).toBeNull();
      expect(screen.queryByRole("button", { name: "Usage" })).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
      proto.scrollIntoView = original;
    }
  });

  it("keeps correcting the jump when the editor layout shifts after an initially stable frame", () => {
    const scroller = document.createElement("div");
    scroller.style.overflowY = "auto";
    scroller.style.scrollBehavior = "smooth";
    const editorEl = document.createElement("div");
    scroller.appendChild(editorEl);
    document.body.appendChild(scroller);
    const editor = new Editor({ element: editorEl, extensions: [StarterKit], content: DOC });

    Object.defineProperties(scroller, {
      clientHeight: { configurable: true, value: 200 },
      scrollHeight: { configurable: true, value: 1_200 },
    });
    scroller.getBoundingClientRect = () =>
      ({ top: 100, bottom: 300, height: 200 } as DOMRect);

    const usage = editor.view.nodeDOM(13) as HTMLElement;
    let usageDocumentTop = 500;
    usage.getBoundingClientRect = () =>
      ({ top: usageDocumentTop - scroller.scrollTop } as DOMRect);
    const coords = vi.spyOn(editor.view, "coordsAtPos").mockImplementation(() => {
      const top = usageDocumentTop - scroller.scrollTop;
      return { top, bottom: top, left: 0, right: 0 };
    });

    vi.useFakeTimers();
    const raf = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => window.setTimeout(() => callback(performance.now()), 16));
    try {
      render(<NoteToc editor={editor} />);
      fireEvent.click(screen.getByRole("button", { name: "toc" }));
      fireEvent.click(screen.getByRole("button", { name: "Usage" }));

      // The first correction and the next animation frame both see the old
      // geometry. The editor then finishes a delayed layout pass.
      window.setTimeout(() => {
        usageDocumentTop = 900;
      }, 32);
      vi.advanceTimersByTime(200);

      expect(scroller.scrollTop).toBe(788);
      expect(scroller.style.scrollBehavior).toBe("smooth");
    } finally {
      coords.mockRestore();
      raf.mockRestore();
      vi.useRealTimers();
      editor.destroy();
      scroller.remove();
    }
  });

  it("uses the note body's explicit scroll container when overflow detection cannot find it", () => {
    const scroller = document.createElement("div");
    const editorEl = document.createElement("div");
    scroller.appendChild(editorEl);
    document.body.appendChild(scroller);
    const editor = new Editor({ element: editorEl, extensions: [StarterKit], content: DOC });
    const scrollContainerRef = createRef<HTMLElement>();
    scrollContainerRef.current = scroller;

    Object.defineProperties(scroller, {
      clientHeight: { configurable: true, value: 200 },
      scrollHeight: { configurable: true, value: 1_200 },
    });
    scroller.getBoundingClientRect = () => ({ top: 100 } as DOMRect);
    const usage = editor.view.nodeDOM(13) as HTMLElement;
    usage.getBoundingClientRect = () => ({ top: 500 - scroller.scrollTop } as DOMRect);
    const coords = vi.spyOn(editor.view, "coordsAtPos").mockImplementation(() => {
      const top = 500 - scroller.scrollTop;
      return { top, bottom: top, left: 0, right: 0 };
    });

    vi.useFakeTimers();
    const raf = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => window.setTimeout(() => callback(performance.now()), 16));
    try {
      render(<NoteToc editor={editor} scrollContainerRef={scrollContainerRef} />);
      fireEvent.click(screen.getByRole("button", { name: "toc" }));
      fireEvent.click(screen.getByRole("button", { name: "Usage" }));
      vi.advanceTimersByTime(200);

      expect(scroller.scrollTop).toBe(388);
    } finally {
      coords.mockRestore();
      raf.mockRestore();
      vi.useRealTimers();
      editor.destroy();
      scroller.remove();
    }
  });

  it("resolves the rendered heading when nodeDOM returns a detached zero-rect node", () => {
    const scroller = document.createElement("div");
    const editorEl = document.createElement("div");
    scroller.appendChild(editorEl);
    document.body.appendChild(scroller);
    const editor = new Editor({ element: editorEl, extensions: [StarterKit], content: DOC });
    const scrollContainerRef = createRef<HTMLElement>();
    scrollContainerRef.current = scroller;

    Object.defineProperties(scroller, {
      clientHeight: { configurable: true, value: 200 },
      scrollHeight: { configurable: true, value: 1_200 },
    });
    scroller.getBoundingClientRect = () => ({ top: 100 } as DOMRect);
    const usageAtPos = editor.view.domAtPos(14).node;
    const usageElement = usageAtPos instanceof Element ? usageAtPos : usageAtPos.parentElement;
    const renderedUsage = usageElement?.closest("h2") as HTMLElement;
    renderedUsage.getBoundingClientRect = () => ({ top: 500 - scroller.scrollTop } as DOMRect);
    vi.spyOn(editor.view, "nodeDOM").mockReturnValue(document.createElement("h2"));
    const coords = vi.spyOn(editor.view, "coordsAtPos").mockImplementation(() => {
      const top = 500 - scroller.scrollTop;
      return { top, bottom: top, left: 0, right: 0 };
    });

    vi.useFakeTimers();
    const raf = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => window.setTimeout(() => callback(performance.now()), 16));
    try {
      render(<NoteToc editor={editor} scrollContainerRef={scrollContainerRef} />);
      fireEvent.click(screen.getByRole("button", { name: "toc" }));
      fireEvent.click(screen.getByRole("button", { name: "Usage" }));
      vi.advanceTimersByTime(200);

      expect(scroller.scrollTop).toBe(388);
    } finally {
      coords.mockRestore();
      raf.mockRestore();
      vi.useRealTimers();
      editor.destroy();
      scroller.remove();
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
