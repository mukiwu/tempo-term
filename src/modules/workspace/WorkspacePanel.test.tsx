import { render, screen, fireEvent, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import "@/i18n";
import { WorkspacePanel } from "./WorkspacePanel";
import { useTabsStore } from "@/stores/tabsStore";
import { leaf } from "@/modules/terminal/lib/terminalLayout";
import { useSessionStatusStore } from "@/modules/claude-progress/lib/sessionStatusStore";
import { progressKey } from "@/modules/claude-progress/lib/progressStore";
import { useWorktreeStore } from "./lib/worktreeStore";
import { useTitlesStore } from "./lib/titlesStore";
import { usePrStore } from "./lib/prStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useEditorStore } from "@/modules/editor/store/editorStore";

beforeEach(() => {
  useEditorStore.setState({ buffers: {} });
  useSessionStatusStore.setState({ statuses: {}, agents: {} });
  useWorktreeStore.setState({ infos: {} });
  useTitlesStore.setState({ titles: {} });
  usePrStore.setState({ prs: {}, fetchedAt: {} });
  useSettingsStore.setState({
    workspaceCard: { status: true, branch: true, cwd: true, pr: true },
    prSource: "auto",
  });
  useTabsStore.setState({
    spaces: [{ id: "s1", name: "Salon" }],
    activeSpaceId: "s1",
    activeId: "t1",
    tabs: [
      {
        id: "t1",
        spaceId: "s1",
        title: "alpha",
        kind: "terminal",
        paneTree: leaf("p1", { kind: "terminal", cwd: "/a" }),
        activeLeafId: "p1",
      },
      {
        id: "t2",
        spaceId: "s1",
        title: "beta",
        kind: "terminal",
        paneTree: leaf("p2", { kind: "terminal", cwd: "/b" }),
        activeLeafId: "p2",
      },
    ],
  });
});

describe("WorkspacePanel", () => {
  it("renders the workspace group and its tab cards", () => {
    render(<WorkspacePanel />);
    expect(screen.getByRole("button", { name: /Salon/ })).toBeInTheDocument();
    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.getByText("beta")).toBeInTheDocument();
  });

  it("activates a tab when its card is clicked", () => {
    render(<WorkspacePanel />);
    fireEvent.click(screen.getByText("beta"));
    expect(useTabsStore.getState().activeId).toBe("t2");
  });

  it("renames a workspace from the panel", () => {
    render(<WorkspacePanel />);
    fireEvent.click(screen.getByRole("button", { name: "Rename space" }));
    const input = screen.getByDisplayValue("Salon");
    fireEvent.change(input, { target: { value: "Studio" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(useTabsStore.getState().spaces[0].name).toBe("Studio");
  });

  it("deletes a workspace from the panel", () => {
    render(<WorkspacePanel />);
    fireEvent.click(screen.getByRole("button", { name: "Delete space" }));
    expect(useTabsStore.getState().spaces.find((s) => s.id === "s1")).toBeUndefined();
  });

  it("collapses a workspace group to hide its cards", () => {
    render(<WorkspacePanel />);
    fireEvent.click(screen.getByRole("button", { name: /Salon/ }));
    expect(screen.queryByText("alpha")).not.toBeInTheDocument();
    expect(screen.queryByText("beta")).not.toBeInTheDocument();
  });

  it("shows a Claude status badge on a card whose cwd has a running session", () => {
    useSessionStatusStore.setState({ statuses: { p1: "active" } });
    render(<WorkspacePanel />);
    const card = screen.getByRole("button", { name: /alpha/ });
    expect(within(card).getByText("Running")).toBeInTheDocument();
  });

  it("shows no status badge when the card cwd has no session", () => {
    render(<WorkspacePanel />);
    const card = screen.getByRole("button", { name: /beta/ });
    expect(within(card).queryByText("Running")).toBeNull();
    expect(within(card).queryByText("Needs Input")).toBeNull();
  });

  it("filters cards to only running sessions", () => {
    useSessionStatusStore.setState({ statuses: { p1: "active" } });
    render(<WorkspacePanel />);
    fireEvent.click(screen.getByRole("button", { name: "Running" }));
    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.queryByText("beta")).toBeNull();
  });

  it("shows all cards again when the filter is reset to All", () => {
    useSessionStatusStore.setState({ statuses: { p1: "active" } });
    render(<WorkspacePanel />);
    fireEvent.click(screen.getByRole("button", { name: "Running" }));
    fireEvent.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.getByText("beta")).toBeInTheDocument();
  });

  it("shows a single branch line for a normal repo card", () => {
    useWorktreeStore.setState({
      infos: {
        "/a": { branch: "main", cwd: "/a", isWorktree: false, mainBranch: null, mainPath: null },
      },
    });
    render(<WorkspacePanel />);
    const card = screen.getByRole("button", { name: /alpha/ });
    expect(within(card).getByText("main")).toBeInTheDocument();
  });

  it("shows main and worktree branch lines for a worktree card", () => {
    useWorktreeStore.setState({
      infos: {
        "/b": {
          branch: "feature",
          cwd: "/b",
          isWorktree: true,
          mainBranch: "main",
          mainPath: "/main",
        },
      },
    });
    render(<WorkspacePanel />);
    const card = screen.getByRole("button", { name: /beta/ });
    expect(within(card).getByText("main")).toBeInTheDocument();
    expect(within(card).getByText("feature")).toBeInTheDocument();
  });

  it("shows the auto session title instead of the tab title", () => {
    useSessionStatusStore.setState({ statuses: { p1: "active" }, agents: { p1: "claude" } });
    useTitlesStore.setState({ titles: { [progressKey("/a", "claude")]: "Auto Alpha" } });
    render(<WorkspacePanel />);
    expect(screen.getByText("Auto Alpha")).toBeInTheDocument();
    expect(screen.queryByText("alpha")).toBeNull();
  });

  it("lists every agent session when a tab is split across two panes", () => {
    useTabsStore.setState({
      spaces: [{ id: "s1", name: "Salon" }],
      activeSpaceId: "s1",
      activeId: "t1",
      tabs: [
        {
          id: "t1",
          spaceId: "s1",
          title: "split",
          kind: "terminal",
          paneTree: {
            kind: "split",
            direction: "row",
            sizes: [0.5, 0.5],
            children: [
              { kind: "leaf", id: "p1", pane: { kind: "terminal", cwd: "/a" } },
              { kind: "leaf", id: "p2", pane: { kind: "terminal", cwd: "/a" } },
            ],
          },
          activeLeafId: "p1",
        },
      ],
    });
    useSessionStatusStore.setState({
      statuses: { p1: "active", p2: "thinking" },
      agents: { p1: "codex", p2: "claude" },
    });
    useTitlesStore.setState({
      titles: {
        [progressKey("/a", "codex")]: "Codex task",
        [progressKey("/a", "claude")]: "Claude task",
      },
    });
    render(<WorkspacePanel />);
    const card = screen.getByRole("button", { name: /split/ });
    expect(within(card).getByText("Codex")).toBeInTheDocument();
    expect(within(card).getByText("Claude")).toBeInTheDocument();
    expect(within(card).getByText("Codex task")).toBeInTheDocument();
    expect(within(card).getByText("Claude task")).toBeInTheDocument();
  });

  it("shows a PR badge on a card whose cwd has a tracked PR", () => {
    usePrStore.setState({
      prs: { "/a": { number: 42, state: "open", url: "u", title: "Add thing" } },
      fetchedAt: { "/a": Date.now() },
    });
    render(<WorkspacePanel />);
    const card = screen.getByRole("button", { name: /alpha/ });
    expect(within(card).getByText(/#42/)).toBeInTheDocument();
  });

  it("hides the status badge when the status block is disabled", () => {
    useSessionStatusStore.setState({ statuses: { p1: "active" } });
    useSettingsStore.setState({
      workspaceCard: { status: false, branch: true, cwd: true, pr: true },
    });
    render(<WorkspacePanel />);
    const card = screen.getByRole("button", { name: /alpha/ });
    expect(within(card).queryByText("Running")).toBeNull();
  });

  it("hides the PR badge when the PR block is disabled", () => {
    usePrStore.setState({
      prs: { "/a": { number: 42, state: "open", url: "u", title: null } },
      fetchedAt: { "/a": Date.now() },
    });
    useSettingsStore.setState({
      workspaceCard: { status: true, branch: true, cwd: true, pr: false },
    });
    render(<WorkspacePanel />);
    const card = screen.getByRole("button", { name: /alpha/ });
    expect(within(card).queryByText(/#42/)).toBeNull();
  });

  it("hides the cwd path when the cwd block is disabled", () => {
    useSettingsStore.setState({
      workspaceCard: { status: true, branch: true, cwd: false, pr: true },
    });
    render(<WorkspacePanel />);
    const card = screen.getByRole("button", { name: /alpha/ });
    expect(within(card).queryByText("/a")).toBeNull();
  });

  it("opens a new launcher tab in the space from its group add button", () => {
    render(<WorkspacePanel />);
    fireEvent.click(screen.getByRole("button", { name: "Add tab" }));
    const added = useTabsStore.getState().tabs.find((tab) => tab.kind === "launcher");
    expect(added).toBeDefined();
    expect(added?.spaceId).toBe("s1");
    expect(useTabsStore.getState().activeId).toBe(added?.id);
  });

  it("opens the new tab in the clicked group's space, not the active one", () => {
    useTabsStore.setState({
      spaces: [
        { id: "s1", name: "Salon" },
        { id: "s2", name: "Studio" },
      ],
      activeSpaceId: "s1",
      activeId: "t1",
      tabs: [
        {
          id: "t1",
          spaceId: "s1",
          title: "alpha",
          kind: "terminal",
          paneTree: leaf("p1", { kind: "terminal", cwd: "/a" }),
          activeLeafId: "p1",
        },
      ],
    });
    render(<WorkspacePanel />);
    // Each group renders its own "Add tab" button; the second one belongs to s2.
    const addButtons = screen.getAllByRole("button", { name: "Add tab" });
    fireEvent.click(addButtons[1]);
    const added = useTabsStore.getState().tabs.find((tab) => tab.kind === "launcher");
    expect(added?.spaceId).toBe("s2");
    expect(useTabsStore.getState().activeSpaceId).toBe("s2");
  });

  it("shows a 1-based index on each card matching its ⌘-number", () => {
    render(<WorkspacePanel />);
    const alpha = screen.getByRole("button", { name: /alpha/ });
    const beta = screen.getByRole("button", { name: /beta/ });
    expect(within(alpha).getByText("1")).toBeInTheDocument();
    expect(within(beta).getByText("2")).toBeInTheDocument();
  });

  it("keeps the card index tied to the space order under a status filter", () => {
    // Only beta (the 2nd tab) is active; filtering to running must still show it
    // as 2, not renumber it to 1, so the number keeps matching ⌘2.
    useSessionStatusStore.setState({ statuses: { p2: "active" } });
    render(<WorkspacePanel />);
    fireEvent.click(screen.getByRole("button", { name: "Running" }));
    const beta = screen.getByRole("button", { name: /beta/ });
    expect(within(beta).getByText("2")).toBeInTheDocument();
    expect(screen.queryByText("alpha")).toBeNull();
  });

  it("opens a tab context menu on right-click with rename and close items", () => {
    render(<WorkspacePanel />);
    const alpha = screen.getByRole("button", { name: /alpha/ });
    fireEvent.contextMenu(alpha);
    // The menu items match those in the main TabBar (Rename Tab / Close Tab).
    expect(screen.getByRole("menuitem", { name: /Rename Tab/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Close Tab/i })).toBeInTheDocument();
  });

  it("closes a tab from the sidebar context menu", () => {
    render(<WorkspacePanel />);
    const beta = screen.getByRole("button", { name: /beta/ });
    fireEvent.contextMenu(beta);
    fireEvent.click(screen.getByRole("menuitem", { name: /Close Tab/i }));
    expect(useTabsStore.getState().tabs.find((tab) => tab.id === "t2")).toBeUndefined();
  });

  it("keeps a dirty tab open and confirms before closing via the sidebar menu", () => {
    // Replace beta with an editor tab pointing at /file.ts so we can mark it dirty.
    useTabsStore.setState({
      ...useTabsStore.getState(),
      tabs: [
        useTabsStore.getState().tabs[0],
        {
          id: "t2",
          spaceId: "s1",
          title: "beta",
          kind: "editor",
          paneTree: leaf("p2", { kind: "editor", path: "/file.ts" }),
          activeLeafId: "p2",
        },
      ],
    });
    useEditorStore.setState({
      buffers: { "/file.ts": { content: "edited", baseline: "" } },
    });
    render(<WorkspacePanel />);
    const beta = screen.getByRole("button", { name: /beta/ });
    fireEvent.contextMenu(beta);
    fireEvent.click(screen.getByRole("menuitem", { name: /Close Tab/i }));
    // Tab must NOT close immediately — confirm dialog should appear and t2 stays.
    expect(useTabsStore.getState().tabs.find((tab) => tab.id === "t2")).toBeDefined();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
  });

  it("renames a tab from the sidebar context menu", () => {
    render(<WorkspacePanel />);
    const alpha = screen.getByRole("button", { name: /alpha/ });
    fireEvent.contextMenu(alpha);
    fireEvent.click(screen.getByRole("menuitem", { name: /Rename Tab/i }));
    const input = screen.getByDisplayValue("alpha");
    fireEvent.change(input, { target: { value: "renamed" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(useTabsStore.getState().tabs.find((tab) => tab.id === "t1")?.title).toBe("renamed");
  });
});
