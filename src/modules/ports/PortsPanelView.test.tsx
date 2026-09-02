import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/i18n";

const { usePorts } = vi.hoisted(() => ({ usePorts: vi.fn() }));
vi.mock("./lib/usePorts", () => ({ usePorts }));
const { killPortProcess, portsAiAvailable, portsAiExplain } = vi.hoisted(() => ({
  killPortProcess: vi.fn(),
  portsAiAvailable: vi.fn(),
  portsAiExplain: vi.fn(),
}));
vi.mock("./lib/portsBridge", () => ({ killPortProcess, portsAiAvailable, portsAiExplain }));

import { PortsPanelView } from "./PortsPanelView";

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
  usePorts.mockReset();
  usePorts.mockReturnValue(sample);
  killPortProcess.mockReset();
  portsAiAvailable.mockReset();
  portsAiAvailable.mockResolvedValue(false);
  portsAiExplain.mockReset();
});

describe("PortsPanelView grouping", () => {
  it("groups ports under project headers, catch-all last, and never reshuffles", async () => {
    usePorts.mockReturnValue([
      { ...sample[0], port: 8080, pid: 20, cwd: "/w/beta", processName: "node", command: "node x/vite" },
      { ...sample[0], port: 3000, pid: 10, cwd: "/w/alpha" },
      { ...sample[0], port: 631, pid: 30, cwd: null, processName: "cupsd", command: null },
    ]);
    render(<PortsPanelView />);
    const headers = await screen.findAllByRole("heading", { level: 3 });
    // textContent carries the port count the header shows beside the name.
    expect(headers.map((h) => h.textContent)).toEqual(["alpha1", "beta1", "Other processes1"]);
    // The plain-English service label replaces the raw runtime name up front.
    expect(screen.getByText("Vite dev server")).toBeInTheDocument();
  });
});

describe("PortsPanelView Apple Intelligence", () => {
  it("offers Ask AI in the expanded row only when the on-device model is available", async () => {
    portsAiAvailable.mockResolvedValue(true);
    portsAiExplain.mockResolvedValue("A dev server. Safe to stop.");
    render(<PortsPanelView />);
    fireEvent.click(await screen.findByRole("button", { name: /details/i }));
    const ask = await screen.findByRole("button", { name: /ask ai/i });

    fireEvent.click(ask);

    expect(await screen.findByText("A dev server. Safe to stop.")).toBeInTheDocument();
    expect(portsAiExplain).toHaveBeenCalledWith(
      expect.objectContaining({ port: 3000, processName: "node" }),
    );
  });

  it("renders no AI affordance at all when the model is unavailable", async () => {
    portsAiAvailable.mockResolvedValue(false);
    render(<PortsPanelView />);
    fireEvent.click(await screen.findByRole("button", { name: /details/i }));
    expect(screen.queryByRole("button", { name: /ask ai/i })).toBeNull();
  });
});

describe("PortsPanelView kill failure", () => {
  it("reports a failed kill in the app's own dialog, not a native one", async () => {
    killPortProcess.mockRejectedValue(new Error("EPERM"));
    render(<PortsPanelView />);

    fireEvent.click(screen.getByRole("button", { name: /kill/i }));
    // The in-app ConfirmDialog asks first; confirm the kill.
    fireEvent.click(screen.getByRole("button", { name: "Kill process" }));

    // The failure lands in the app-styled InfoDialog (repo convention: no
    // native alert surfaces), with the process name and the error detail.
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("Failed to kill node");
    expect(dialog.textContent).toContain("EPERM");

    // Acknowledging it closes the dialog.
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
