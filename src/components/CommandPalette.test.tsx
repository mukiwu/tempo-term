import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@/i18n";
import { CommandPalette } from "./CommandPalette";
import { useTabsStore } from "@/stores/tabsStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useConnectionsStore } from "@/stores/connectionsStore";
import { useSessionsStore } from "@/modules/sessions/lib/sessionsStore";
import { useRecentFilesStore } from "@/modules/explorer/lib/recentFiles";
import type { SessionSummary } from "@/modules/sessions/lib/sessionsBridge";

vi.mock("@/modules/explorer/lib/fsBridge", () => ({
  fsListFiles: vi.fn(() => Promise.resolve(["/p/src/main.ts", "/p/README.md"])),
  canSearchRoot: (root: string | null) => root !== null,
}));

const session: SessionSummary = {
  id: "s1",
  agent: "claude",
  project_cwd: "/p",
  title: "Fix pricing",
  started_at: 1,
  ended_at: 2,
  message_count: 3,
  user_message_count: 1,
  output_tokens: null,
  model: null,
  file_path: "/x.jsonl",
  pinned: false,
};

function renderPalette(onClose = vi.fn()) {
  render(<CommandPalette onClose={onClose} />);
  return { onClose, input: screen.getByRole("textbox") };
}

describe("CommandPalette", () => {
  beforeEach(() => {
    cleanup();
    useTabsStore.setState({ tabs: [], activeId: null, spaces: [], activeSpaceId: null });
    useWorkspaceStore.setState({ rootPath: "/p" });
    useRecentFilesStore.setState({ paths: [] });
    useConnectionsStore.setState({
      connections: [{ id: "c1", name: "prod-box", host: "10.0.0.1", port: 22, user: "deploy" } as never],
    });
    useSessionsStore.setState({ sessions: [session], start: vi.fn(async () => {}) });
  });

  it("lists commands from the launcher and the menus", () => {
    renderPalette();
    expect(screen.getByRole("option", { name: /^Terminal/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Split Right/ })).toBeInTheDocument();
    // Clipboard items act on the previously focused element, so they are left out.
    expect(screen.queryByRole("option", { name: /^Copy/ })).not.toBeInTheDocument();
    // Its own entry would only close and reopen the palette.
    expect(screen.queryByRole("option", { name: /Command Palette/ })).not.toBeInTheDocument();
  });

  it("finds files, sessions and hosts from the All tab", async () => {
    const { input } = renderPalette();
    fireEvent.change(input, { target: { value: "main" } });
    await waitFor(() => expect(screen.getByRole("option", { name: /main\.ts/ })).toBeInTheDocument());
    fireEvent.change(input, { target: { value: "pricing" } });
    expect(screen.getByRole("option", { name: /Fix pricing/ })).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "prod" } });
    expect(screen.getByRole("option", { name: /prod-box/ })).toBeInTheDocument();
  });

  it("narrows to one category and cycles categories with Tab", () => {
    const { input } = renderPalette();
    fireEvent.click(screen.getByRole("tab", { name: "Hosts" }));
    expect(screen.getAllByRole("option")).toHaveLength(1);
    fireEvent.keyDown(input, { key: "Tab" });
    expect(screen.getByRole("tab", { name: "All" })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(input, { key: "Tab", shiftKey: true });
    expect(screen.getByRole("tab", { name: "Hosts" })).toHaveAttribute("aria-selected", "true");
  });

  it("runs the highlighted item on Enter and closes", async () => {
    const { input, onClose } = renderPalette();
    fireEvent.change(input, { target: { value: "main.ts" } });
    await waitFor(() => screen.getByRole("option", { name: /main\.ts/ }));
    fireEvent.keyDown(input, { key: "Enter" });
    const tab = useTabsStore.getState().tabs[0];
    expect(tab.paneTree.kind === "leaf" && tab.paneTree.pane).toMatchObject({
      kind: "editor",
      path: "/p/src/main.ts",
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("opens a session in the sessions tab", () => {
    const { input } = renderPalette();
    fireEvent.change(input, { target: { value: "pricing" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(useSessionsStore.getState().selectedId).toBe("s1");
  });

  it("moves the selection with the arrow keys and closes on Escape", () => {
    const { input, onClose } = renderPalette();
    const first = screen.getAllByRole("option")[0];
    expect(first).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});

describe("CommandPalette in Traditional Chinese", () => {
  it("still finds commands by their English names", async () => {
    const { default: i18n } = await import("@/i18n");
    await i18n.changeLanguage("zh-Hant");
    try {
      render(<CommandPalette onClose={vi.fn()} />);
      fireEvent.change(screen.getByRole("textbox"), { target: { value: "terminal" } });
      expect(screen.getByRole("option", { name: /^終端機/ })).toBeInTheDocument();
      fireEvent.change(screen.getByRole("textbox"), { target: { value: "split right" } });
      expect(screen.getByRole("option", { name: /向右分割/ })).toBeInTheDocument();
    } finally {
      await i18n.changeLanguage("en");
    }
  });
});
