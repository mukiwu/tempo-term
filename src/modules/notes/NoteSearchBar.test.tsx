import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  createNoteSearchController,
  NoteSearchBar,
  type NoteSearchController,
} from "./NoteSearchBar";
import { NoteSearchHighlight } from "./noteSearchHighlight";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

function makeController(): NoteSearchController {
  return {
    setQuery: vi.fn(() => ({ current: 1, total: 3 })),
    findNext: vi.fn(() => ({ current: 2, total: 3 })),
    findPrevious: vi.fn(() => ({ current: 3, total: 3 })),
    clear: vi.fn(),
  };
}

describe("NoteSearchBar", () => {
  it("focuses the search field and highlights matches while the user types", () => {
    const search = makeController();
    render(<NoteSearchBar search={search} onClose={() => {}} />);

    const input = screen.getByRole("textbox");
    expect(input).toHaveFocus();

    fireEvent.change(input, { target: { value: "needle" } });

    expect(search.setQuery).toHaveBeenCalledWith("needle");
    expect(screen.getByText("1 / 3")).toBeInTheDocument();
  });

  it("moves through results with Enter and Shift+Enter", () => {
    const search = makeController();
    render(<NoteSearchBar search={search} onClose={() => {}} />);
    const input = screen.getByRole("textbox");

    fireEvent.change(input, { target: { value: "needle" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(search.findNext).toHaveBeenCalledWith("needle");
    expect(screen.getByText("2 / 3")).toBeInTheDocument();

    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(search.findPrevious).toHaveBeenCalledWith("needle");
    expect(screen.getByText("3 / 3")).toBeInTheDocument();
  });

  it("closes with Escape and clears highlights when it unmounts", () => {
    const search = makeController();
    const onClose = vi.fn();
    const { unmount } = render(<NoteSearchBar search={search} onClose={onClose} />);

    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();

    unmount();
    expect(search.clear).toHaveBeenCalledOnce();
  });

  it("moves through results from the toolbar buttons", () => {
    const search = makeController();
    render(<NoteSearchBar search={search} onClose={() => {}} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "needle" } });

    fireEvent.click(screen.getByRole("button", { name: "search.previous" }));
    fireEvent.click(screen.getByRole("button", { name: "search.next" }));

    expect(search.findPrevious).toHaveBeenCalledWith("needle");
    expect(search.findNext).toHaveBeenCalledWith("needle");
  });

  it("re-applies the current query when the search controller is replaced", () => {
    const firstSearch = makeController();
    const { rerender } = render(
      <NoteSearchBar search={firstSearch} onClose={() => {}} />,
    );
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "needle" } });

    const replacementSearch = makeController();
    rerender(<NoteSearchBar search={replacementSearch} onClose={() => {}} />);

    expect(firstSearch.clear).toHaveBeenCalledOnce();
    expect(replacementSearch.setQuery).toHaveBeenCalledWith("needle");
  });
});

describe("createNoteSearchController", () => {
  function editorWithText(text: string) {
    const element = document.createElement("div");
    document.body.appendChild(element);
    return new Editor({
      element,
      extensions: [StarterKit, NoteSearchHighlight],
      content: `<p>${text}</p>`,
    });
  }

  it("highlights every case-insensitive match and marks the active one", () => {
    const editor = editorWithText("Needle, haystack, NEEDLE");
    const search = createNoteSearchController(editor);

    expect(search.setQuery("needle")).toEqual({ current: 1, total: 2 });
    expect(editor.view.dom.querySelectorAll(".note-search-match")).toHaveLength(2);
    expect(editor.view.dom.querySelector("[data-note-search-active]")?.textContent).toBe("Needle");

    expect(search.findNext("needle")).toEqual({ current: 2, total: 2 });
    expect(editor.view.dom.querySelector("[data-note-search-active]")?.textContent).toBe("NEEDLE");
    editor.destroy();
  });

  it("clears every decoration when search closes", () => {
    const editor = editorWithText("needle needle");
    const search = createNoteSearchController(editor);
    search.setQuery("needle");

    search.clear();

    expect(editor.view.dom.querySelector(".note-search-match")).toBeNull();
    editor.destroy();
  });

  it("finds a query that crosses inline formatting boundaries", () => {
    const editor = editorWithText("Needle <strong>across</strong> marks");
    const search = createNoteSearchController(editor);

    expect(search.setQuery("needle across")).toEqual({ current: 1, total: 1 });

    editor.destroy();
  });

  it("starts from the first match at or after the editor cursor", () => {
    const editor = editorWithText("needle hay needle");
    editor.commands.setTextSelection(8);
    const search = createNoteSearchController(editor);

    expect(search.setQuery("needle")).toEqual({ current: 2, total: 2 });

    editor.destroy();
  });
});
