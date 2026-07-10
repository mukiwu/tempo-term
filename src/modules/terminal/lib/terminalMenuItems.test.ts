import { describe, it, expect } from "vitest";
import { terminalMenuSpecs } from "./terminalMenuItems";

describe("terminalMenuSpecs", () => {
  it("lists the five actions in stable order with edit and view groups", () => {
    const specs = terminalMenuSpecs({ hasSelection: true });
    expect(specs.map((s) => s.action)).toEqual(["copy", "paste", "selectAll", "clear", "search"]);
    expect(specs.map((s) => s.group)).toEqual([0, 0, 0, 1, 1]);
  });

  it("greys copy out without a selection instead of hiding it", () => {
    const withSel = terminalMenuSpecs({ hasSelection: true });
    expect(withSel.find((s) => s.action === "copy")?.enabled).toBe(true);

    const withoutSel = terminalMenuSpecs({ hasSelection: false });
    expect(withoutSel.find((s) => s.action === "copy")?.enabled).toBe(false);
    expect(withoutSel.map((s) => s.action)).toContain("copy");
  });

  it("keeps paste, select-all, clear and search always enabled", () => {
    for (const spec of terminalMenuSpecs({ hasSelection: false })) {
      if (spec.action !== "copy") {
        expect(spec.enabled).toBe(true);
      }
    }
  });
});
