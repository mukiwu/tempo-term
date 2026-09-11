import { describe, expect, it } from "vitest";
import type { GitStatus } from "@/modules/source-control/lib/gitBridge";
import { uncommittedRowSummary } from "./uncommittedRow";

const clean: GitStatus = { branch: "main", staged: [], unstaged: [] };
const dirty: GitStatus = {
  branch: "main",
  staged: [{ path: "a.ts", staged: true, status: "M" }],
  unstaged: [
    { path: "b.ts", staged: false, status: "M" },
    { path: "new.ts", staged: false, status: "?" },
  ],
};

describe("uncommittedRowSummary", () => {
  it("counts both sides", () => {
    expect(uncommittedRowSummary(dirty, true, true)).toEqual({ staged: 1, unstaged: 2 });
  });

  it("is nothing at all when the row is switched off", () => {
    expect(uncommittedRowSummary(dirty, false, true)).toBeNull();
    expect(uncommittedRowSummary(clean, false, false)).toBeNull();
  });

  it("keeps a zero row for a clean tree by default", () => {
    // The quiet row is what stops the graph jumping a row on every commit.
    expect(uncommittedRowSummary(clean, true, true)).toEqual({ staged: 0, unstaged: 0 });
  });

  it("drops the row on a clean tree when asked to", () => {
    expect(uncommittedRowSummary(clean, true, false)).toBeNull();
  });

  it("still shows a dirty tree when clean rows are dropped", () => {
    expect(uncommittedRowSummary(dirty, true, false)).toEqual({ staged: 1, unstaged: 2 });
  });

  it("treats a status that has not arrived as nothing to show, not as clean", () => {
    // Otherwise the row would blink in and out on every reload while the
    // keep-when-clean setting is off.
    expect(uncommittedRowSummary(null, true, false)).toBeNull();
    // With the default it stays put, counting zero until the status lands.
    expect(uncommittedRowSummary(null, true, true)).toEqual({ staged: 0, unstaged: 0 });
  });
});
