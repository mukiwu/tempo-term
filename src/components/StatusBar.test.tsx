import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StatusBar } from "./StatusBar";
import "../i18n";
import { useUpdaterStore } from "@/stores/updaterStore";

const { useSystemStats } = vi.hoisted(() => ({ useSystemStats: vi.fn() }));
vi.mock("@/modules/sysmon/lib/useSystemStats", () => ({ useSystemStats }));

const AVAILABLE = {
  version: "0.0.9",
  notes: "",
  releaseUrl: "",
  update: null as never,
};

describe("StatusBar update indicator", () => {
  beforeEach(() => {
    useUpdaterStore.setState({ available: null, modalOpen: false });
  });
  afterEach(() => {
    useUpdaterStore.setState({ available: null, modalOpen: false });
  });

  it("hides the indicator when no update is available", () => {
    render(<StatusBar />);
    expect(screen.queryByLabelText("Update available")).not.toBeInTheDocument();
  });

  it("shows the indicator when an update is available and the modal is closed", () => {
    useUpdaterStore.setState({ available: AVAILABLE, modalOpen: false });
    render(<StatusBar />);
    expect(screen.getByLabelText("Update available")).toBeInTheDocument();
  });

  it("hides the indicator while the modal is open", () => {
    useUpdaterStore.setState({ available: AVAILABLE, modalOpen: true });
    render(<StatusBar />);
    expect(screen.queryByLabelText("Update available")).not.toBeInTheDocument();
  });

  it("opens the modal when the indicator is clicked", () => {
    useUpdaterStore.setState({ available: AVAILABLE, modalOpen: false });
    render(<StatusBar />);

    fireEvent.click(screen.getByLabelText("Update available"));

    expect(useUpdaterStore.getState().modalOpen).toBe(true);
  });
});

describe("StatusBar system metrics", () => {
  beforeEach(() => {
    useUpdaterStore.setState({ available: null, modalOpen: false });
    useSystemStats.mockReturnValue(null);
  });
  afterEach(() => {
    useSystemStats.mockReturnValue(null);
  });

  it("shows CPU, RAM and network rates when stats are available", () => {
    useSystemStats.mockReturnValue({
      cpuUsage: 42,
      ramUsed: 8 * 1024 ** 3,
      ramTotal: 16 * 1024 ** 3,
      netRx: 1024 * 1024,
      netTx: 512 * 1024,
    });
    render(<StatusBar />);
    expect(screen.getByText("42%")).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(screen.getByText("1.0 MB/s")).toBeInTheDocument();
    expect(screen.getByText("512.0 KB/s")).toBeInTheDocument();
  });

  it("shows no metrics before the first sample arrives", () => {
    useSystemStats.mockReturnValue(null);
    render(<StatusBar />);
    expect(screen.queryByText(/%$/)).toBeNull();
  });
});
