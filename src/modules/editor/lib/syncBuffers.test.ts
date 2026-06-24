import { beforeEach, describe, expect, it } from "vitest";
import { useEditorStore } from "@/modules/editor/store/editorStore";
import { useTabsStore } from "@/stores/tabsStore";
import { pruneEditorBuffers } from "./syncBuffers";

beforeEach(() => {
  useEditorStore.setState({ buffers: {} });
  useTabsStore.setState({ tabs: [], activeId: null, spaces: [], activeSpaceId: null });
});

describe("pruneEditorBuffers", () => {
  it("forgets a buffer whose file is no longer open, so a discarded edit is gone", () => {
    const editor = useEditorStore.getState();
    editor.setBaseline("/a.ts", "saved on disk");
    editor.setContent("/a.ts", "unsaved edit");
    // No tab is open for /a.ts (it was closed without saving).
    pruneEditorBuffers();
    expect("/a.ts" in useEditorStore.getState().buffers).toBe(false);
  });

  it("keeps a buffer whose file is still open in a tab", () => {
    useTabsStore.getState().openEditorTab("/a.ts");
    const editor = useEditorStore.getState();
    editor.setBaseline("/a.ts", "saved on disk");
    editor.setContent("/a.ts", "unsaved edit");
    pruneEditorBuffers();
    expect("/a.ts" in useEditorStore.getState().buffers).toBe(true);
  });
});
