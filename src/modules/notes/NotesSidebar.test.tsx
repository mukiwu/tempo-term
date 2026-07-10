import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NotesSidebar } from "./NotesSidebar";
import { useTabsStore } from "@/stores/tabsStore";
import { useNotesStore } from "@/stores/notesStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { pickNotesFolder } from "./lib/pickNotesFolder";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("./lib/pickNotesFolder", () => ({
  pickNotesFolder: vi.fn(),
}));

describe("NotesSidebar opening a note", () => {
  beforeEach(() => {
    useTabsStore.setState({ tabs: [], activeId: null, spaces: [], activeSpaceId: null });
    useSettingsStore.setState({ notesFolderPath: "/notes" });
    useNotesStore.setState({
      tree: [
        { kind: "note", name: "todo.md", title: "todo", path: "/notes/todo.md", isConflict: false },
      ],
    });
  });

  it("opens the clicked note via openFromSidebar instead of openNoteTab", () => {
    render(<NotesSidebar />);

    fireEvent.click(screen.getByText("todo"));

    const tabs = useTabsStore.getState().tabs;
    expect(tabs).toHaveLength(1);
    const pane = tabs[0].paneTree;
    expect(pane.kind === "leaf" && pane.pane).toMatchObject({
      kind: "note",
      noteId: "/notes/todo.md",
    });
  });

  it("splits a second note next to an already-open one instead of focusing it", () => {
    render(<NotesSidebar />);

    fireEvent.click(screen.getByText("todo"));
    fireEvent.click(screen.getByText("todo"));

    expect(useTabsStore.getState().tabs).toHaveLength(1);
    const tab = useTabsStore.getState().tabs[0];
    expect(tab.paneTree.kind).toBe("split");
  });
});

describe("NotesSidebar at pane capacity", () => {
  beforeEach(() => {
    useTabsStore.setState({ tabs: [], activeId: null, spaces: [], activeSpaceId: null });
    useSettingsStore.setState({ notesFolderPath: "/notes" });
    useNotesStore.setState({
      tree: [
        { kind: "note", name: "todo.md", title: "todo", path: "/notes/todo.md", isConflict: false },
      ],
    });
  });

  it("shows an InfoDialog instead of opening a 9th pane", () => {
    useTabsStore.getState().openEditorTab("/0.ts");
    for (let i = 1; i < 8; i++) {
      useTabsStore.getState().openFromSidebar({ kind: "editor", path: `/${i}.ts` });
    }
    render(<NotesSidebar />);

    fireEvent.click(screen.getByText("todo"));

    expect(screen.getByText("paneCapacityAlert")).toBeInTheDocument();
  });
});

describe("NotesSidebar context menu: open in split pane", () => {
  beforeEach(() => {
    useTabsStore.setState({ tabs: [], activeId: null, spaces: [], activeSpaceId: null });
    useSettingsStore.setState({ notesFolderPath: "/notes" });
    useNotesStore.setState({
      tree: [
        { kind: "note", name: "todo.md", title: "todo", path: "/notes/todo.md", isConflict: false },
      ],
    });
  });

  it("opens the note in split pane via right-click", () => {
    render(<NotesSidebar />);

    fireEvent.contextMenu(screen.getByText("todo"));
    fireEvent.click(screen.getByText("open"));

    expect(useTabsStore.getState().tabs).toHaveLength(1);
    const tab = useTabsStore.getState().tabs[0];
    const pane = tab.paneTree;
    expect(pane.kind === "leaf" && pane.pane).toMatchObject({
      kind: "note",
      noteId: "/notes/todo.md",
    });
  });
});

describe("NotesSidebar: change notes folder", () => {
  beforeEach(() => {
    vi.mocked(pickNotesFolder).mockReset();
    useTabsStore.setState({ tabs: [], activeId: null, spaces: [], activeSpaceId: null });
    useSettingsStore.setState({ notesFolderPath: "/notes" });
    useNotesStore.setState({ tree: [], setRoot: vi.fn() });
  });

  it("asks for confirmation before switching to the picked folder", async () => {
    vi.mocked(pickNotesFolder).mockResolvedValue("/new-notes");
    render(<NotesSidebar />);

    fireEvent.click(screen.getByLabelText("changeFolder"));

    await waitFor(() => expect(screen.getByText("changeFolderConfirmTitle")).toBeInTheDocument());
    expect(useSettingsStore.getState().notesFolderPath).toBe("/notes");

    fireEvent.click(screen.getByText("actions.confirm"));

    expect(useSettingsStore.getState().notesFolderPath).toBe("/new-notes");
    expect(useNotesStore.getState().setRoot).toHaveBeenCalledWith("/new-notes");
  });

  it("keeps the current folder when the confirmation is cancelled", async () => {
    vi.mocked(pickNotesFolder).mockResolvedValue("/new-notes");
    render(<NotesSidebar />);

    fireEvent.click(screen.getByLabelText("changeFolder"));
    await waitFor(() => expect(screen.getByText("changeFolderConfirmTitle")).toBeInTheDocument());

    fireEvent.click(screen.getByText("actions.cancel"));

    expect(screen.queryByText("changeFolderConfirmTitle")).not.toBeInTheDocument();
    expect(useSettingsStore.getState().notesFolderPath).toBe("/notes");
    expect(useNotesStore.getState().setRoot).not.toHaveBeenCalled();
  });

  it("does nothing when the folder picker is cancelled", async () => {
    vi.mocked(pickNotesFolder).mockResolvedValue(null);
    render(<NotesSidebar />);

    fireEvent.click(screen.getByLabelText("changeFolder"));

    await waitFor(() => expect(pickNotesFolder).toHaveBeenCalled());
    expect(screen.queryByText("changeFolderConfirmTitle")).not.toBeInTheDocument();
    expect(useNotesStore.getState().setRoot).not.toHaveBeenCalled();
  });

  it("does not crash when the folder picker rejects", async () => {
    vi.mocked(pickNotesFolder).mockRejectedValue(new Error("dialog plugin failed"));
    render(<NotesSidebar />);

    fireEvent.click(screen.getByLabelText("changeFolder"));

    await waitFor(() => expect(pickNotesFolder).toHaveBeenCalled());
    expect(screen.queryByText("changeFolderConfirmTitle")).not.toBeInTheDocument();
    expect(useNotesStore.getState().setRoot).not.toHaveBeenCalled();
  });
});

describe("NotesSidebar context menu: open in new tab", () => {
  beforeEach(() => {
    useTabsStore.setState({ tabs: [], activeId: null, spaces: [], activeSpaceId: null });
    useSettingsStore.setState({ notesFolderPath: "/notes" });
    useNotesStore.setState({
      tree: [
        { kind: "note", name: "todo.md", title: "todo", path: "/notes/todo.md", isConflict: false },
      ],
    });
  });

  it("always opens a new tab via right-click, even when the note is already open", () => {
    useTabsStore.getState().openEditorTab("/a.ts");
    render(<NotesSidebar />);

    fireEvent.contextMenu(screen.getByText("todo"));
    fireEvent.click(screen.getByText("openInNewTab"));

    expect(useTabsStore.getState().tabs).toHaveLength(2);
    const newTab = useTabsStore.getState().tabs[1];
    const pane = newTab.paneTree;
    expect(pane.kind === "leaf" && pane.pane).toMatchObject({
      kind: "note",
      noteId: "/notes/todo.md",
    });
  });
});
