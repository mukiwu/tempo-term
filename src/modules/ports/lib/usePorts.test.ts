import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchPorts } = vi.hoisted(() => ({ fetchPorts: vi.fn() }));
vi.mock("./portsBridge", () => ({ fetchPorts }));

import { usePorts } from "./usePorts";

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
  fetchPorts.mockReset();
  fetchPorts.mockResolvedValue(sample);
});

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
});
