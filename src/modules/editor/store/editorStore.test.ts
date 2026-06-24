import { beforeEach, describe, expect, it } from "vitest";
import { useEditorStore } from "./editorStore";

beforeEach(() => {
  useEditorStore.setState({ buffers: {} });
});

describe("editorStore", () => {
  it("is not dirty right after a buffer is loaded", () => {
    useEditorStore.getState().setBaseline("/a.ts", "hello");
    expect(useEditorStore.getState().isDirty("/a.ts")).toBe(false);
    expect(useEditorStore.getState().contentOf("/a.ts")).toBe("hello");
  });

  it("becomes dirty when content diverges from the baseline", () => {
    const store = useEditorStore.getState();
    store.setBaseline("/a.ts", "hello");
    store.setContent("/a.ts", "hello world");
    expect(useEditorStore.getState().isDirty("/a.ts")).toBe(true);
  });

  it("is clean again when edited back to the baseline", () => {
    const store = useEditorStore.getState();
    store.setBaseline("/a.ts", "hello");
    store.setContent("/a.ts", "changed");
    store.setContent("/a.ts", "hello");
    expect(useEditorStore.getState().isDirty("/a.ts")).toBe(false);
  });

  it("clears dirty after saving (baseline reset to current content)", () => {
    const store = useEditorStore.getState();
    store.setBaseline("/a.ts", "hello");
    store.setContent("/a.ts", "edited");
    store.markSaved("/a.ts");
    expect(useEditorStore.getState().isDirty("/a.ts")).toBe(false);
    expect(useEditorStore.getState().contentOf("/a.ts")).toBe("edited");
  });

  it("reports unknown files as not dirty with empty content", () => {
    expect(useEditorStore.getState().isDirty("/missing.ts")).toBe(false);
    expect(useEditorStore.getState().contentOf("/missing.ts")).toBe("");
  });

  it("forgets a buffer so a discarded edit no longer lingers", () => {
    const store = useEditorStore.getState();
    store.setBaseline("/a.ts", "hello");
    store.setContent("/a.ts", "edited but never saved");
    store.forget("/a.ts");
    expect("/a.ts" in useEditorStore.getState().buffers).toBe(false);
    expect(useEditorStore.getState().isDirty("/a.ts")).toBe(false);
  });
});
