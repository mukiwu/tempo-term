import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/i18n";

const { usePorts } = vi.hoisted(() => ({ usePorts: vi.fn() }));
vi.mock("./lib/usePorts", () => ({ usePorts }));

import { PortsIndicator } from "./PortsIndicator";
import { useUiStore, DEFAULT_DOCK } from "@/stores/uiStore";
import { useSettingsStore } from "@/stores/settingsStore";

const sample = [
  {
    port: 3000,
    protocol: "tcp",
    bindAddr: "127.0.0.1",
    pid: 10,
    processName: "node",
    command: "node server.js",
    cwd: "/work",
    cpuUsage: 0,
    memoryBytes: 2048,
    uptimeSecs: 90,
    isCurrentUser: true,
  },
];

beforeEach(() => {
  useUiStore.setState({
    panelDock: { ...DEFAULT_DOCK.panelDock },
    panelOrder: {
      left: [...DEFAULT_DOCK.panelOrder.left],
      right: [...DEFAULT_DOCK.panelOrder.right],
    },
    activePanel: { ...DEFAULT_DOCK.activePanel },
    width: { ...DEFAULT_DOCK.width },
    visible: { left: true, right: false },
  });
  useSettingsStore.getState().setShowAllPorts(false);
  usePorts.mockReset();
  usePorts.mockReturnValue(sample);
});

describe("PortsIndicator", () => {
  it("shows the port count and activates the Ports panel on click", () => {
    render(<PortsIndicator />);
    expect(screen.getByText("1")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /ports/i }));

    // Ports docks on the right by default; clicking reveals + activates it there.
    const s = useUiStore.getState();
    expect(s.activePanel.right).toBe("ports");
    expect(s.visible.right).toBe(true);
  });

  it("renders no button when there are no ports", () => {
    usePorts.mockReturnValue([]);
    render(<PortsIndicator />);
    expect(screen.queryByRole("button", { name: /ports/i })).toBeNull();
  });
});
