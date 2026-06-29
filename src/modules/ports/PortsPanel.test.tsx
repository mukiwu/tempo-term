import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "@/i18n";

// PortRow imports openUrl at module load; stub it so the import is inert in jsdom.
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

import { PortsPanel } from "./PortsPanel";
import type { PortInfo } from "./lib/portsBridge";

const port = (over: Partial<PortInfo> = {}): PortInfo => ({
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
  ...over,
});

function setup(over: Partial<Parameters<typeof PortsPanel>[0]> = {}) {
  const props = {
    ports: [port()],
    open: true,
    onClose: vi.fn(),
    showAll: false,
    onToggleShowAll: vi.fn(),
    onRequestKill: vi.fn(),
    onOpenTerminal: vi.fn(),
    ...over,
  };
  render(<PortsPanel {...props} />);
  return props;
}

describe("PortsPanel", () => {
  it("renders nothing when closed", () => {
    setup({ open: false });
    expect(screen.queryByText("node")).toBeNull();
  });

  it("lists each port with its number and process name", () => {
    setup();
    expect(screen.getByText(":3000")).toBeInTheDocument();
    expect(screen.getByText("node")).toBeInTheDocument();
  });

  it("toggles Show all", () => {
    const props = setup();
    fireEvent.click(screen.getByRole("switch", { name: /show all/i }));
    expect(props.onToggleShowAll).toHaveBeenCalledWith(true);
  });

  it("expands a row to reveal detail and calls kill", () => {
    const props = setup();
    fireEvent.click(screen.getByRole("button", { name: /details for port 3000/i }));
    expect(screen.getByText("node server.js")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /kill port 3000/i }));
    expect(props.onRequestKill).toHaveBeenCalledWith(expect.objectContaining({ port: 3000 }));
  });

  it("shows an empty state when there are no ports", () => {
    setup({ ports: [] });
    expect(screen.getByText(/no ports/i)).toBeInTheDocument();
  });

  it("shows a loading state before the first poll resolves", () => {
    setup({ ports: null });
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
    expect(screen.queryByText(/no ports/i)).toBeNull();
  });
});
