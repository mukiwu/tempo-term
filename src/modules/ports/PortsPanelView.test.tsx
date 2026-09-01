import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/i18n";

const { usePorts } = vi.hoisted(() => ({ usePorts: vi.fn() }));
vi.mock("./lib/usePorts", () => ({ usePorts }));
const { killPortProcess } = vi.hoisted(() => ({ killPortProcess: vi.fn() }));
vi.mock("./lib/portsBridge", () => ({ killPortProcess }));

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
