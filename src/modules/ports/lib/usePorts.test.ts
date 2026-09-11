import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fetchPorts } = vi.hoisted(() => ({ fetchPorts: vi.fn() }));
const windowState = vi.hoisted(() => ({ visible: true }));
vi.mock("./portsBridge", () => ({ fetchPorts }));
vi.mock("@/lib/windowActivity", () => ({ useWindowVisible: () => windowState.visible }));

import { usePortMonitor, usePorts } from "./usePorts";

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
  windowState.visible = true;
  fetchPorts.mockReset();
  fetchPorts.mockResolvedValue(sample);
});

afterEach(() => vi.useRealTimers());

describe("usePorts", () => {
  it("returns null before the first sample, then the latest ports", async () => {
    const { result } = renderHook(() => usePorts(false));
    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current).toEqual(sample));
  });

  it("passes the showAll flag through to fetchPorts", async () => {
    renderHook(() => usePorts(true));
    await waitFor(() => expect(fetchPorts).toHaveBeenCalledWith(true));
  });

  it("stops polling while hidden and resumes with one immediate poll", async () => {
    vi.useFakeTimers();
    const { rerender } = renderHook(() => usePorts(false, 5_000));
    await act(async () => Promise.resolve());
    expect(fetchPorts).toHaveBeenCalledTimes(1);

    windowState.visible = false;
    rerender();
    await act(async () => vi.advanceTimersByTimeAsync(15_000));
    expect(fetchPorts).toHaveBeenCalledTimes(1);

    windowState.visible = true;
    rerender();
    await act(async () => Promise.resolve());
    expect(fetchPorts).toHaveBeenCalledTimes(2);

    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(fetchPorts).toHaveBeenCalledTimes(3);
  });
});

describe("usePortMonitor", () => {
  it("stops automatic polling while paused but allows a manual refresh", async () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ live }) => usePortMonitor(false, live, 5_000),
      { initialProps: { live: true } },
    );
    await act(async () => Promise.resolve());
    expect(fetchPorts).toHaveBeenCalledTimes(1);

    rerender({ live: false });
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(fetchPorts).toHaveBeenCalledTimes(1);

    await act(async () => result.current.refresh());
    expect(fetchPorts).toHaveBeenCalledTimes(2);
    expect(result.current.ports).toEqual(sample);
    expect(result.current.lastUpdatedAt).not.toBeNull();
  });

  it("keeps the last snapshot and exposes an error when refresh fails", async () => {
    const { result } = renderHook(() => usePortMonitor(false, true));
    await waitFor(() => expect(result.current.ports).toEqual(sample));

    fetchPorts.mockRejectedValueOnce(new Error("unavailable"));
    await act(async () => result.current.refresh());
    expect(result.current.ports).toEqual(sample);
    expect(result.current.error).toBe("unavailable");
  });
});
