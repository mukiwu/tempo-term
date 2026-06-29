import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/i18n";

const { usePorts } = vi.hoisted(() => ({ usePorts: vi.fn() }));
vi.mock("./lib/usePorts", () => ({ usePorts }));
const { killPortProcess } = vi.hoisted(() => ({ killPortProcess: vi.fn() }));
vi.mock("./lib/portsBridge", () => ({ killPortProcess }));
const { newTerminalTab } = vi.hoisted(() => ({ newTerminalTab: vi.fn() }));
vi.mock("@/stores/tabsStore", () => ({
  useTabsStore: Object.assign(() => {}, { getState: () => ({ newTerminalTab }) }),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ message: vi.fn() }));

import { PortsIndicator } from "./PortsIndicator";
import { useUiStore } from "@/stores/uiStore";
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
  useUiStore.getState().setPortsPanelOpen(false);
  useSettingsStore.getState().setShowAllPorts(false);
  usePorts.mockReset();
  usePorts.mockReturnValue(sample);
  killPortProcess.mockReset();
  killPortProcess.mockResolvedValue(undefined);
});

describe("PortsIndicator", () => {
  it("shows the port count and opens the panel on click", () => {
    render(<PortsIndicator />);
    expect(screen.getByText("1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /ports/i }));
    expect(screen.getByText(":3000")).toBeInTheDocument();
  });

  it("renders no button when there are no ports and the panel is closed", () => {
    usePorts.mockReturnValue([]);
    render(<PortsIndicator />);
    expect(screen.queryByRole("button", { name: /ports/i })).toBeNull();
  });
});
