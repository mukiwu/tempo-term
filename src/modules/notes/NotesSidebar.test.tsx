import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NotesSidebar } from "./NotesSidebar";
import { useTabsStore } from "@/stores/tabsStore";
import { useNotesStore } from "@/stores/notesStore";
import { useSettingsStore } from "@/stores/settingsStore";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
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
