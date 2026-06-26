import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchSystemStats } = vi.hoisted(() => ({ fetchSystemStats: vi.fn() }));
vi.mock("./sysinfoBridge", () => ({ fetchSystemStats }));

import { useSystemStats } from "./useSystemStats";

const sample = { cpuUsage: 42, ramUsed: 8, ramTotal: 16 };

beforeEach(() => {
  fetchSystemStats.mockReset();
  fetchSystemStats.mockResolvedValue(sample);
});

describe("useSystemStats", () => {
  it("returns null before the first sample, then the latest stats", async () => {
    const { result } = renderHook(() => useSystemStats());
    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current).toEqual(sample));
  });
});
