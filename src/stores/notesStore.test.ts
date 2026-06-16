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

  it("moves a note into a folder and back to root", () => {
    const folder = useNotesStore.getState().createFolder("Git");
    const note = useNotesStore.getState().createNote();
    useNotesStore.getState().moveNote(note, folder);
    expect(useNotesStore.getState().noteById(note)?.folderId).toBe(folder);
    useNotesStore.getState().moveNote(note, null);
    expect(useNotesStore.getState().noteById(note)?.folderId).toBeNull();
  });

  it("reorders a note before another, adopting its folder", () => {
    const folder = useNotesStore.getState().createFolder("F");
    const a = useNotesStore.getState().createNote(folder);
    const b = useNotesStore.getState().createNote(); // root
    useNotesStore.getState().reorderNote(b, a); // drop b before a
    const ids = useNotesStore.getState().notes.map((n) => n.id);
    expect(ids.indexOf(b)).toBeLessThan(ids.indexOf(a));
    expect(useNotesStore.getState().noteById(b)?.folderId).toBe(folder);
  });
});
