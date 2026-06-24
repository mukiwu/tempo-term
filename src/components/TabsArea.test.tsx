import { render, screen, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTabsStore } from "@/stores/tabsStore";
import { leaf } from "@/modules/terminal/lib/terminalLayout";

// Track when a tab's content mounts/unmounts so we can assert that switching
// workspaces never tears a running terminal down.
const { mountSpy, unmountSpy } = vi.hoisted(() => ({
  mountSpy: vi.fn(),
  unmountSpy: vi.fn(),
}));

vi.mock("@/modules/terminal/PaneTabContent", async () => {
  const { useEffect } = await import("react");
  return {
    PaneTabContent: ({ tab }: { tab: { id: string } }) => {
      useEffect(() => {
        mountSpy(tab.id);
        return () => unmountSpy(tab.id);
      }, [tab.id]);
      return <div data-testid={`pane-${tab.id}`} />;
    },
  };
});

vi.mock("@/components/LauncherPanel", () => ({
  LauncherPanel: () => <div data-testid="launcher" />,
}));

import { TabsArea } from "./TabsArea";

beforeEach(() => {
  mountSpy.mockClear();
  unmountSpy.mockClear();
  useTabsStore.setState({
    spaces: [{ id: "s1", name: "One" }],
    activeSpaceId: "s1",
    tabs: [
      {
        id: "t1",
        spaceId: "s1",
        title: "Terminal 1",
        kind: "terminal",
        paneTree: leaf("p1", { kind: "terminal" }),
        activeLeafId: "p1",
      },
    ],
    activeId: "t1",
  });
});

describe("TabsArea", () => {
  it("keeps an existing tab mounted when a new workspace clears the active tab", () => {
    render(<TabsArea />);
    expect(mountSpy).toHaveBeenCalledWith("t1");
    expect(unmountSpy).not.toHaveBeenCalled();

    // Opening a new, empty workspace leaves no active tab. The terminal running
    // in the previous workspace must keep its session alive, not be torn down.
    act(() => {
      useTabsStore.getState().newSpace("Two");
    });

    expect(unmountSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId("pane-t1")).toBeInTheDocument();
  });

  it("returns to the same running session after a round trip through a new workspace", () => {
    render(<TabsArea />);

    act(() => {
      useTabsStore.getState().newSpace("Two");
    });
    act(() => {
      useTabsStore.getState().setActiveSpace("s1");
    });

    // Mounted exactly once and never torn down: the terminal the user comes back
    // to is the original live session, not a fresh shell restored from history.
    expect(mountSpy).toHaveBeenCalledTimes(1);
    expect(unmountSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId("pane-t1")).toBeInTheDocument();
  });
});
