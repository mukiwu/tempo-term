import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/i18n";

const { usePortMonitor } = vi.hoisted(() => ({ usePortMonitor: vi.fn() }));
vi.mock("./lib/usePorts", () => ({ usePortMonitor }));
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
  usePortMonitor.mockReset();
  usePortMonitor.mockReturnValue({
    ports: sample,
    error: null,
    lastUpdatedAt: new Date("2026-09-10T12:00:00Z").getTime(),
    refreshing: false,
    refresh: vi.fn(),
  });
  killPortProcess.mockReset();
  portsAiAvailable.mockReset();
  portsAiAvailable.mockResolvedValue(false);
  portsAiExplain.mockReset();
});

describe("PortsPanelView grouping", () => {
  it("groups ports under project headers, catch-all last, and never reshuffles", async () => {
    usePortMonitor.mockReturnValue({
      ports: [
        { ...sample[0], port: 8080, pid: 20, cwd: "/w/beta", processName: "node", command: "node x/vite" },
        { ...sample[0], port: 3000, pid: 10, cwd: "/w/alpha" },
        { ...sample[0], port: 631, pid: 30, cwd: null, processName: "cupsd", command: null },
      ],
      error: null,
      lastUpdatedAt: Date.now(),
      refreshing: false,
      refresh: vi.fn(),
    });
    render(<PortsPanelView />);
    const headers = await screen.findAllByRole("heading", { level: 3 });
    // textContent carries the port count the header shows beside the name.
    expect(headers.map((h) => h.textContent)).toEqual(["alpha1", "beta1", "Other processes1"]);
    // The plain-English service label replaces the raw runtime name up front.
    expect(screen.getByText("Vite dev server")).toBeInTheDocument();
  });
});

describe("PortsPanelView monitoring controls", () => {
  it("filters all visible fields and reports the result count", async () => {
    render(<PortsPanelView />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "server.js" } });
    expect(await screen.findByText("Showing 1 of 1")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "postgres" } });
    expect(await screen.findByText("No matching ports")).toBeInTheDocument();
  });

  it("pauses only the open panel and disables snapshot-changing filters", () => {
    const { rerender } = render(<PortsPanelView />);
    fireEvent.click(screen.getByRole("button", { name: "Pause automatic updates" }));
    rerender(<PortsPanelView />);

    expect(usePortMonitor).toHaveBeenLastCalledWith(false, false, 5000);
    expect(screen.getByRole("switch", { name: "Show all" })).toBeDisabled();
    expect(screen.getByText("Paused")).toBeInTheDocument();
  });
});

describe("PortsPanelView Apple Intelligence", () => {
  it("leads the action row with Ask AI, expands the row, and renders the styled answer", async () => {
    portsAiAvailable.mockResolvedValue(true);
    portsAiExplain.mockResolvedValue("A dev server. **Safe** to stop.");
    const { container } = render(<PortsPanelView />);

    // The trigger lives on the always-visible action row, first position —
    // no expanding needed to reach it.
    const ask = await screen.findByRole("button", { name: /ask ai/i });
    const openBrowser = screen.getByRole("button", { name: /browser/i });
    expect(ask.compareDocumentPosition(openBrowser) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.click(ask);

    // The row auto-expands and the answer renders as markdown, not raw text.
    expect(await screen.findByText(/A dev server/)).toBeInTheDocument();
    await waitFor(() => expect(container.querySelector("strong")?.textContent).toBe("Safe"));
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
