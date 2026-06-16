import { beforeEach, describe, expect, it } from "vitest";
import { useNotesStore } from "./notesStore";

function reset() {
  localStorage.clear();
  useNotesStore.setState({ folders: [], notes: [] });
}

describe("notesStore", () => {
  beforeEach(reset);

  it("creates a note with default title at the root", () => {
    const id = useNotesStore.getState().createNote();
    const note = useNotesStore.getState().noteById(id);
    expect(note).toMatchObject({ title: "Untitled", content: "", folderId: null });
  });

  it("updates a note's title and content", () => {
    const id = useNotesStore.getState().createNote();
    useNotesStore.getState().updateNote(id, { title: "Ideas", content: "hello 你好" });
    const note = useNotesStore.getState().noteById(id);
    expect(note?.title).toBe("Ideas");
    expect(note?.content).toBe("hello 你好");
  });

  it("creates notes inside a folder", () => {
    const folder = useNotesStore.getState().createFolder("Git");
    const note = useNotesStore.getState().createNote(folder);
    expect(useNotesStore.getState().noteById(note)?.folderId).toBe(folder);
  });

  it("deleting a folder removes its notes", () => {
    const folder = useNotesStore.getState().createFolder("Temp");
    const inside = useNotesStore.getState().createNote(folder);
    const atRoot = useNotesStore.getState().createNote();
    useNotesStore.getState().deleteFolder(folder);
    expect(useNotesStore.getState().noteById(inside)).toBeUndefined();
    expect(useNotesStore.getState().noteById(atRoot)).toBeDefined();
    expect(useNotesStore.getState().folders).toHaveLength(0);
  });

  it("deletes a single note", () => {
    const id = useNotesStore.getState().createNote();
    useNotesStore.getState().deleteNote(id);
    expect(useNotesStore.getState().noteById(id)).toBeUndefined();
  });

  it("persists notes so they survive a reload", () => {
    useNotesStore.getState().createNote();
    expect(localStorage.getItem("tempoterm-notes")).toContain("Untitled");
  });
});
