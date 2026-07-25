// Regression test for the fabricated-empty-baseline bug: when the initial
// read fails (file too large, unreadable, not a regular file), the editor
// used to set an empty baseline — a clean-looking empty buffer — and a save
// would then TRUNCATE the real file on disk. A failed load must show an
// error state and block saving entirely.
import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/i18n";
import { EditorTabContent } from "./EditorTabContent";
import { useEditorStore } from "./store/editorStore";
import { useTabsStore } from "@/stores/tabsStore";
import { leaf } from "@/modules/terminal/lib/terminalLayout";
import { saveFocusedEditor } from "./lib/editorBus";

const { mockFsWriteFile, mockFsReadFile } = vi.hoisted(() => ({
  mockFsWriteFile: vi.fn().mockResolvedValue(undefined),
  mockFsReadFile: vi.fn(),
}));

vi.mock("@/modules/explorer/lib/fsBridge", () => ({
  fsReadFile: mockFsReadFile,
  fsWriteFile: mockFsWriteFile,
  // The toolbar's breadcrumb (paneCrumbs) resolves home + siblings on mount.
  fsHomeDir: vi.fn().mockResolvedValue("/home/user"),
  fsReadDir: vi.fn().mockResolvedValue([]),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

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

describe("EditorTabContent failed load", () => {
  beforeEach(() => {
    mockFsWriteFile.mockClear();
    mockFsReadFile.mockRejectedValue(
      "file too large to open (52428800 bytes, limit 10485760): /big.log",
    );
    useEditorStore.setState({ buffers: {} });
    useTabsStore.setState({
      spaces: [{ id: "s1", name: "Space" }],
      activeSpaceId: "s1",
      tabs: [fixtureTab("leaf1", "/big.log")],
      activeId: "tab1",
    });
  });

  it("shows an error state instead of a clean empty buffer", async () => {
    render(<EditorTabContent path="/big.log" leafId="leaf1" />);
    await act(async () => {});

    expect(screen.getByText("This file cannot be opened")).toBeInTheDocument();
    // No fabricated baseline: the buffer must simply not exist.
    expect(useEditorStore.getState().buffers["/big.log"]).toBeUndefined();
  });

  it("refuses to save, so the real file is never truncated", async () => {
    render(<EditorTabContent path="/big.log" leafId="leaf1" />);
    await act(async () => {});

    await act(async () => {
      saveFocusedEditor();
      await Promise.resolve();
    });

    expect(mockFsWriteFile).not.toHaveBeenCalled();
  });
});
