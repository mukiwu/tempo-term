import { describe, expect, it } from "vitest";
import { collectAgentTargets } from "./agentTargets";
import { leaf } from "@/modules/terminal/lib/terminalLayout";
import type { Tab } from "@/stores/tabsStore";

function tab(id: string, paneId: string, title: string): Tab {
  return {
    id,
    spaceId: "s1",
    title,
    kind: "terminal",
    paneTree: leaf(paneId, { kind: "terminal", cwd: "/a" }),
    activeLeafId: paneId,
    paneOrder: [paneId],
  };
}

describe("collectAgentTargets", () => {
  it("lists panes that have both a live status and a classified agent", () => {
    const targets = collectAgentTargets(
      [tab("t1", "p1", "work"), tab("t2", "p2", "idle-shell")],
      { p1: "active" },
      { p1: "claude", p2: "codex" },
    );
    expect(targets).toEqual([{ leafId: "p1", tabId: "t1", label: "Claude · work" }]);
  });

  it("returns an empty list when nothing is running", () => {
    expect(collectAgentTargets([tab("t1", "p1", "work")], {}, {})).toEqual([]);
  });
});
