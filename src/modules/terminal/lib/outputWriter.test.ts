import { describe, expect, it, vi } from "vitest";
import { createOutputWriter } from "./outputWriter";

/** A scheduler whose frames fire only when the test calls runAll(). */
function fakeScheduler() {
  let pending: Array<() => void> = [];
  return {
    schedule: (cb: () => void): number => {
      pending.push(cb);
      return pending.length;
    },
    cancel: (): void => {},
    runAll: (): void => {
      const cbs = pending;
      pending = [];
      for (const cb of cbs) cb();
    },
  };
}

describe("createOutputWriter", () => {
  it("buffers a pushed chunk and writes it on the next scheduled flush", () => {
    const sched = fakeScheduler();
    const write = vi.fn();
    const writer = createOutputWriter({ write, schedule: sched.schedule, cancel: sched.cancel });

    writer.push("hello");
    expect(write).not.toHaveBeenCalled();

    sched.runAll();
    expect(write).toHaveBeenCalledWith("hello");
  });

  it("writes at most maxBytesPerFlush per frame and reschedules the rest", () => {
    const sched = fakeScheduler();
    const write = vi.fn();
    const writer = createOutputWriter({
      write,
      schedule: sched.schedule,
      cancel: sched.cancel,
      maxBytesPerFlush: 5,
    });

    writer.push("aaa"); // 3 bytes
    writer.push("bbb"); // 3 bytes — together 6 > 5

    sched.runAll();
    expect(write.mock.calls.map((c) => c[0])).toEqual(["aaa"]);

    sched.runAll();
    expect(write.mock.calls.map((c) => c[0])).toEqual(["aaa", "bbb"]);
  });

  it("drops the oldest queued bytes when the backlog exceeds the cap", () => {
    const sched = fakeScheduler();
    const write = vi.fn();
    const writer = createOutputWriter({
      write,
      schedule: sched.schedule,
      cancel: sched.cancel,
      backlogCap: 5,
    });

    writer.push("aaa"); // 3 bytes, within cap
    writer.push("bbb"); // total 6 > 5 — oldest "aaa" is dropped

    expect(writer.droppedBytes).toBe(3);

    sched.runAll();
    expect(write.mock.calls.map((c) => c[0])).toEqual(["bbb"]);
  });

  it("reports the running dropped total via onDrop when it sheds output", () => {
    const sched = fakeScheduler();
    const seen: number[] = [];
    const writer = createOutputWriter({
      write: vi.fn(),
      schedule: sched.schedule,
      cancel: sched.cancel,
      backlogCap: 5,
      onDrop: (total) => seen.push(total),
    });

    writer.push("aaa"); // within cap, no drop
    writer.push("bbb"); // total 6 > 5 — drops "aaa" (3 bytes)

    expect(seen).toEqual([3]);
    expect(writer.droppedBytes).toBe(3);
  });

  it("does not write anything once disposed, even if a flush was pending", () => {
    const sched = fakeScheduler();
    const write = vi.fn();
    const writer = createOutputWriter({ write, schedule: sched.schedule, cancel: sched.cancel });

    writer.push("x");
    writer.dispose();
    sched.runAll();

    expect(write).not.toHaveBeenCalled();
  });
});
