import { render, screen, fireEvent, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import "@/i18n";
import { WorkspacePanel } from "./WorkspacePanel";
import { useTabsStore } from "@/stores/tabsStore";
import { leaf } from "@/modules/terminal/lib/terminalLayout";
import { useProgressStore } from "@/modules/claude-progress/lib/progressStore";
import { emptyProgressState, reduceProgress } from "@/modules/claude-progress/lib/progressState";
import { useWorktreeStore } from "./lib/worktreeStore";
import { useTitlesStore } from "./lib/titlesStore";

function activeSession() {
  return reduceProgress(emptyProgressState(), { kind: "tool:start", id: "t1", name: "Bash" });
}

beforeEach(() => {
  useProgressStore.setState({ sessions: {} });
  useWorktreeStore.setState({ infos: {} });
  useTitlesStore.setState({ titles: {} });
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

  it("collapses a workspace group to hide its cards", () => {
    render(<WorkspacePanel />);
    fireEvent.click(screen.getByRole("button", { name: /Salon/ }));
    expect(screen.queryByText("alpha")).not.toBeInTheDocument();
    expect(screen.queryByText("beta")).not.toBeInTheDocument();
  });

  it("shows a Claude status badge on a card whose cwd has a running session", () => {
    useProgressStore.setState({ sessions: { "/a": activeSession() } });
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
    useProgressStore.setState({ sessions: { "/a": activeSession() } });
    render(<WorkspacePanel />);
    fireEvent.click(screen.getByRole("button", { name: "Running" }));
    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.queryByText("beta")).toBeNull();
  });

  it("shows all cards again when the filter is reset to All", () => {
    useProgressStore.setState({ sessions: { "/a": activeSession() } });
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
    useTitlesStore.setState({ titles: { "/a": "Auto Alpha" } });
    render(<WorkspacePanel />);
    expect(screen.getByText("Auto Alpha")).toBeInTheDocument();
    expect(screen.queryByText("alpha")).toBeNull();
  });
});
