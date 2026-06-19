import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withMinDuration } from "./withMinDuration";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("withMinDuration", () => {
  it("holds until minMs even when the work resolves immediately", async () => {
    const settled: string[] = [];
    const pending = withMinDuration(Promise.resolve("done"), 400).then((v) => {
      settled.push(v);
      return v;
    });

    await vi.advanceTimersByTimeAsync(399);
    expect(settled).toEqual([]);

    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toEqual(["done"]);

    await expect(pending).resolves.toBe("done");
  });

  it("adds no extra delay once the work already outlasts minMs", async () => {
    let finishWork!: (value: string) => void;
    const work = new Promise<string>((resolve) => {
      finishWork = resolve;
    });
    const settled: string[] = [];
    const pending = withMinDuration(work, 100).then((v) => settled.push(v));

    await vi.advanceTimersByTimeAsync(100);
    expect(settled).toEqual([]); // min elapsed but work still pending

    finishWork("late");
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toEqual(["late"]);
    await pending;
  });

  it("rejects with the work error without waiting out minMs", async () => {
    const failing = Promise.reject(new Error("boom"));
    await expect(withMinDuration(failing, 1000)).rejects.toThrow("boom");
  });
});
