import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ConnectionsPanel } from "./ConnectionsPanel";
import { useTabsStore } from "@/stores/tabsStore";
import { useConnectionsStore } from "@/stores/connectionsStore";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts?.name ? `${key}:${opts.name}` : key,
  }),
}));

const CONNECTION = {
  id: "c1",
  name: "prod-box",
  host: "prod.example.com",
  port: 22,
  user: "deploy",
  authMethod: "password" as const,
  rememberSecret: false,
};

describe("ConnectionsPanel opening a connection", () => {
  beforeEach(() => {
    useTabsStore.setState({ tabs: [], activeId: null, spaces: [], activeSpaceId: null });
    useConnectionsStore.setState({ connections: [CONNECTION] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("opens the connection via openFromSidebar", () => {
    render(<ConnectionsPanel />);

    fireEvent.click(screen.getByText("prod-box"));

    const tabs = useTabsStore.getState().tabs;
    expect(tabs).toHaveLength(1);
    const pane = tabs[0].paneTree;
    expect(pane.kind === "leaf" && pane.pane).toMatchObject({
      kind: "terminal",
      ssh: { connectionId: "c1" },
    });
  });

  it("shows an InfoDialog and does not open a second connection when one is already open", () => {
    render(<ConnectionsPanel />);

    fireEvent.click(screen.getByText("prod-box"));
    fireEvent.click(screen.getByText("prod-box"));

    expect(useTabsStore.getState().tabs).toHaveLength(1);
    expect(
      screen.getByText("connectionsPanel.alreadyOpenAlert:prod-box"),
    ).toBeInTheDocument();
  });

  it("closes the InfoDialog when its OK button is clicked", () => {
    render(<ConnectionsPanel />);

    fireEvent.click(screen.getByText("prod-box"));
    fireEvent.click(screen.getByText("prod-box"));
    fireEvent.click(screen.getByRole("button", { name: "actions.confirm" }));

    expect(
      screen.queryByText("connectionsPanel.alreadyOpenAlert:prod-box"),
    ).not.toBeInTheDocument();
  });

  it("shows the capacity InfoDialog instead of opening a 9th pane", () => {
    useTabsStore.getState().openEditorTab("/0.ts");
    for (let i = 1; i < 8; i++) {
      useTabsStore.getState().openFromSidebar({ kind: "editor", path: `/${i}.ts` });
    }
    render(<ConnectionsPanel />);

    fireEvent.click(screen.getByText("prod-box"));

    expect(screen.getByText("paneCapacityAlert")).toBeInTheDocument();
  });

  it("opens the connection via right-click 'open in split pane' menu item", () => {
    render(<ConnectionsPanel />);

    fireEvent.contextMenu(screen.getByText("prod-box"));
    fireEvent.click(screen.getByText("connectionsPanel.open"));

    const tabs = useTabsStore.getState().tabs;
    expect(tabs).toHaveLength(1);
    const pane = tabs[0].paneTree;
    expect(pane.kind === "leaf" && pane.pane).toMatchObject({
      kind: "terminal",
      ssh: { connectionId: "c1" },
    });
  });

  it("shows 'already connected' dialog when right-clicking 'open in split pane' on an already-connected row", () => {
    render(<ConnectionsPanel />);

    fireEvent.click(screen.getByText("prod-box"));
    fireEvent.contextMenu(screen.getByText("prod-box"));
    fireEvent.click(screen.getByText("connectionsPanel.open"));

    expect(useTabsStore.getState().tabs).toHaveLength(1);
    expect(screen.getByText("connectionsPanel.alreadyOpenAlert:prod-box")).toBeInTheDocument();
  });

  it("always opens a new tab via right-click, even when the connection is already open", () => {
    useTabsStore.getState().openEditorTab("/a.ts");
    render(<ConnectionsPanel />);

    fireEvent.contextMenu(screen.getByText("prod-box"));
    fireEvent.click(screen.getByText("connectionsPanel.openInNewTab"));

    expect(useTabsStore.getState().tabs).toHaveLength(2);
  });

  it("blocks a second connection via right-click when one is already open, showing the same InfoDialog", () => {
    render(<ConnectionsPanel />);
    fireEvent.click(screen.getByText("prod-box"));

    fireEvent.contextMenu(screen.getByText("prod-box"));
    fireEvent.click(screen.getByText("connectionsPanel.openInNewTab"));

    expect(useTabsStore.getState().tabs).toHaveLength(1);
    expect(screen.getByText("connectionsPanel.alreadyOpenAlert:prod-box")).toBeInTheDocument();
  });
});
