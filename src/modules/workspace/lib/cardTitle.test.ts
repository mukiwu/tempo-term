import { describe, expect, it } from "vitest";
import { selectCardTitle } from "./cardTitle";
import { leaf } from "@/modules/terminal/lib/terminalLayout";
import type { Tab } from "@/stores/tabsStore";

function tab(partial: Partial<Tab> & Pick<Tab, "paneTree" | "activeLeafId">): Tab {
  return {
    id: "t1",
    spaceId: "s1",
    title: "tab-title",
    kind: "terminal",
    ...partial,
  } as Tab;
}

describe("selectCardTitle", () => {
  it("keeps the manual title when the tab was renamed", () => {
    const t = tab({
      paneTree: leaf("p1", { kind: "terminal", cwd: "/a" }),
      activeLeafId: "p1",
      renamed: true,
    });
    expect(selectCardTitle(t, { "/a": "auto title" })).toBe("tab-title");
  });

  it("uses the auto session title when not renamed", () => {
    const t = tab({ paneTree: leaf("p1", { kind: "terminal", cwd: "/a" }), activeLeafId: "p1" });
    expect(selectCardTitle(t, { "/a": "auto title" })).toBe("auto title");
  });

  it("falls back to the tab title when there is no auto title", () => {
    const t = tab({ paneTree: leaf("p1", { kind: "terminal", cwd: "/a" }), activeLeafId: "p1" });
    expect(selectCardTitle(t, {})).toBe("tab-title");
  });
});
