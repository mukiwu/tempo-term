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

  it("alerts and does not open a second connection when one is already open", () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    render(<ConnectionsPanel />);

    fireEvent.click(screen.getByText("prod-box"));
    fireEvent.click(screen.getByText("prod-box"));

    expect(useTabsStore.getState().tabs).toHaveLength(1);
    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(alertSpy).toHaveBeenCalledWith("connectionsPanel.alreadyOpenAlert:prod-box");
  });
});
