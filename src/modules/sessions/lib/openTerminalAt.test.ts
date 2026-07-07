import { describe, expect, it, vi } from "vitest";
import { openTerminalAt } from "./openTerminalAt";
import { useTabsStore } from "@/stores/tabsStore";

describe("openTerminalAt", () => {
  it("creates a terminal tab at the given cwd and returns its id", () => {
    const newTerminalTab = vi.fn().mockReturnValue("tab-9");
    vi.spyOn(useTabsStore, "getState").mockReturnValue({ newTerminalTab } as never);

    const id = openTerminalAt("/tmp/proj-a");

    expect(newTerminalTab).toHaveBeenCalledWith("/tmp/proj-a");
    expect(id).toBe("tab-9");
  });
});
