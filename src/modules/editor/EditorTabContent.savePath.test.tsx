// Regression test for the stale saver closure: PaneTabContent renders
// EditorTabContent without a `key` on `path` (src/modules/terminal/PaneTabContent.tsx),
// so opening a different file in the same pane rerenders this component
// instance instead of remounting it. The saver registered for the File
// menu's Save action must always write the CURRENT path, not the path that
// was active when the saver was first registered.
import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/i18n";
import { EditorTabContent } from "./EditorTabContent";
import { useEditorStore } from "./store/editorStore";
import { useTabsStore } from "@/stores/tabsStore";
import { leaf } from "@/modules/terminal/lib/terminalLayout";
import { saveFocusedEditor } from "./lib/editorBus";

const { mockFsWriteFile } = vi.hoisted(() => ({
  mockFsWriteFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/modules/explorer/lib/fsBridge", () => ({
  fsReadFile: vi.fn().mockResolvedValue(""),
  fsWriteFile: mockFsWriteFile,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

// Keep this test focused on the saver-registration bug: stub CodeMirror so we
// don't drag its heavy Tauri/codemirror dependencies into a component test.
vi.mock("@uiw/react-codemirror", () => ({
  default: () => null,
}));

function fixtureTab(leafId: string, path: string) {
  return {
    id: "tab1",
    spaceId: "s1",
    title: "editor",
    kind: "editor" as const,
    paneTree: leaf(leafId, { kind: "editor" as const, path }),
    activeLeafId: leafId,
    paneOrder: [leafId],
  };
}

describe("EditorTabContent saver registration follows the current path", () => {
  beforeEach(() => {
    mockFsWriteFile.mockClear();
    useEditorStore.setState({ buffers: {} });
    useTabsStore.setState({
      spaces: [{ id: "s1", name: "Space" }],
      activeSpaceId: "s1",
      tabs: [fixtureTab("leaf1", "/a.txt")],
      activeId: "tab1",
    });
  });

  it("saves the new path after the same pane opens a different file without remounting", async () => {
    const { rerender } = render(<EditorTabContent path="/a.txt" leafId="leaf1" />);
    await act(async () => {});

    // Same component instance, same leafId, new path — mirrors PaneTabContent
    // rerendering the pane in place (no key) when a different file is opened.
    rerender(<EditorTabContent path="/b.txt" leafId="leaf1" />);
    await act(async () => {});

    await act(async () => {
      saveFocusedEditor();
      await Promise.resolve();
    });

    expect(mockFsWriteFile).toHaveBeenCalledWith("/b.txt", expect.anything());
    expect(mockFsWriteFile).not.toHaveBeenCalledWith("/a.txt", expect.anything());
  });
});
