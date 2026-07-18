import { useEffect } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NoteTabContent } from "./NoteTabContent";

const readNote = vi.fn(async () => "A searchable note");

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("@/stores/notesStore", () => ({
  useNotesStore: {
    getState: () => ({ readNote, writeNote: vi.fn(), renameNote: vi.fn(), refresh: vi.fn() }),
  },
}));

vi.mock("@/stores/tabsStore", () => ({
  useTabsStore: (selector: (state: object) => unknown) =>
    selector({
      activeId: "tab",
      tabs: [{ id: "tab", activeLeafId: "leaf" }],
      setTabTitle: vi.fn(),
      setPaneContent: vi.fn(),
    }),
}));

vi.mock("@/modules/notes/lib/notesWatch", () => ({
  onNotesChanged: vi.fn(async () => () => {}),
}));

vi.mock("./NoteEditor", () => ({
  NoteEditor: ({ onEditorReady }: { onEditorReady?: (editor: object | null) => void }) => {
    useEffect(() => {
      onEditorReady?.({});
      return () => onEditorReady?.(null);
    }, [onEditorReady]);
    return <div>A searchable note</div>;
  },
}));

vi.mock("./NoteToc", () => ({ NoteToc: () => <button type="button">toc</button> }));

vi.mock("./NoteSearchBar", () => ({
  createNoteSearchController: () => ({ clear: vi.fn() }),
  NoteSearchBar: () => (
    <input data-note-search-input aria-label="search.placeholder" autoFocus />
  ),
}));

describe("NoteTabContent note search", () => {
  beforeEach(() => readNote.mockClear());

  it("opens the focused search field from the toolbar icon", async () => {
    render(<NoteTabContent noteId="/notes/test.md" tabId="tab" leafId="leaf" />);

    const button = await screen.findByRole("button", { name: "search.open" });
    fireEvent.click(button);

    expect(screen.getByRole("textbox", { name: "search.placeholder" })).toHaveFocus();
  });

  it("opens search with Ctrl+F and closes it with Escape", async () => {
    render(<NoteTabContent noteId="/notes/test.md" tabId="tab" leafId="leaf" />);
    await screen.findByRole("button", { name: "search.open" });

    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    expect(screen.getByRole("textbox", { name: "search.placeholder" })).toHaveFocus();

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("textbox", { name: "search.placeholder" })).not.toBeInTheDocument();
    });
  });

  it("ignores Ctrl+F when this note is not the active split pane", async () => {
    render(<NoteTabContent noteId="/notes/test.md" tabId="other-tab" leafId="other-leaf" />);
    await screen.findByRole("button", { name: "search.open" });

    fireEvent.keyDown(window, { key: "f", ctrlKey: true });

    expect(screen.queryByRole("textbox", { name: "search.placeholder" })).not.toBeInTheDocument();
  });
});
