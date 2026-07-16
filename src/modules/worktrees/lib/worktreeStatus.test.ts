import { describe, expect, it } from "vitest";
import { leaf, splitLeaf } from "@/modules/terminal/lib/terminalLayout";
import type { Tab } from "@/stores/tabsStore";
import { worktreeSessionStatus } from "./worktreeStatus";

const WT = "/repo-worktrees/feature";

/** A tab whose single terminal pane `p1` sits in `cwd`. */
function tabAt(id: string, leafId: string, cwd: string | undefined, tabCwd?: string): Tab {
  return {
    id,
    spaceId: "s1",
    title: id,
    kind: "terminal",
    paneTree: leaf(leafId, { kind: "terminal", cwd }),
    activeLeafId: leafId,
    paneOrder: [leafId],
    cwd: tabCwd,
  };
}

describe("worktreeSessionStatus", () => {
  it("reports nothing when no pane sits in the worktree", () => {
    const tabs = [tabAt("a", "p1", "/somewhere/else")];
    expect(worktreeSessionStatus(tabs, { p1: "active" }, {}, WT, false)).toEqual({
      status: null,
      agent: null,
    });
  });

  it("picks up a pane inside the worktree", () => {
    const tabs = [tabAt("a", "p1", `${WT}/src`)];
    expect(worktreeSessionStatus(tabs, { p1: "active" }, { p1: "claude" }, WT, false)).toEqual({
      status: "active",
      agent: "claude",
    });
  });

  it("does not claim a pane from a sibling worktree that shares the prefix", () => {
    // /repo-worktrees/feature-2 must not count as inside /repo-worktrees/feature.
    const tabs = [tabAt("a", "p1", `${WT}-2/src`)];
    expect(worktreeSessionStatus(tabs, { p1: "active" }, {}, WT, false).status).toBeNull();
  });

  it("falls back to the tab's cwd when a pane has not reported one yet", () => {
    // A freshly spawned pane has no live cwd; the tab's starting dir still
    // places it, otherwise a just-launched agent would show no status.
    const tabs = [tabAt("a", "p1", undefined, WT)];
    expect(worktreeSessionStatus(tabs, { p1: "thinking" }, {}, WT, false).status).toBe("thinking");
  });

  it("takes the most urgent status across panes and tabs", () => {
    // waiting-approval > active > thinking > idle, matching the card badge.
    const tabs = [
      tabAt("a", "p1", WT),
      tabAt("b", "p2", `${WT}/src`),
      tabAt("c", "p3", `${WT}/docs`),
    ];
    const statuses = { p1: "idle", p2: "waiting-approval", p3: "active" } as const;
    expect(worktreeSessionStatus(tabs, statuses, {}, WT, false).status).toBe("waiting-approval");
  });

  it("reports the agent of the pane that won the status", () => {
    const tabs = [tabAt("a", "p1", WT), tabAt("b", "p2", `${WT}/src`)];
    const result = worktreeSessionStatus(
      tabs,
      { p1: "idle", p2: "waiting-approval" },
      { p1: "claude", p2: "codex" },
      WT,
      false,
    );
    // The row says "waiting" — it must name the agent that is actually waiting.
    expect(result).toEqual({ status: "waiting-approval", agent: "codex" });
  });

  it("names no agent rather than borrowing one from a different pane", () => {
    // The waiting pane's agent is not classified yet, while another pane holds
    // an idle Claude. Saying "Claude — waiting for you" would point at the one
    // agent that is definitely *not* waiting.
    const tabs = [tabAt("a", "p1", WT), tabAt("b", "p2", `${WT}/src`)];
    const result = worktreeSessionStatus(
      tabs,
      { p1: "idle", p2: "waiting-approval" },
      { p1: "claude" },
      WT,
      false,
    );
    expect(result).toEqual({ status: "waiting-approval", agent: null });
  });

  it("still names an agent when its pane has no status yet", () => {
    const tabs = [tabAt("a", "p1", WT)];
    expect(worktreeSessionStatus(tabs, {}, { p1: "claude" }, WT, false)).toEqual({
      status: null,
      agent: "claude",
    });
  });

  it("walks every pane of a split tab", () => {
    const tree = splitLeaf(
      leaf("p1", { kind: "terminal", cwd: "/elsewhere" }),
      "p1",
      "row",
      "p2",
      { kind: "terminal", cwd: WT },
    );
    const tabs: Tab[] = [
      {
        id: "a",
        spaceId: "s1",
        title: "a",
        kind: "terminal",
        paneTree: tree,
        activeLeafId: "p1",
        paneOrder: ["p1", "p2"],
      },
    ];
    expect(worktreeSessionStatus(tabs, { p2: "active" }, {}, WT, false).status).toBe("active");
  });

  it("ignores non-terminal panes sitting in the worktree", () => {
    const tabs: Tab[] = [
      {
        id: "a",
        spaceId: "s1",
        title: "a",
        kind: "editor",
        paneTree: leaf("p1", { kind: "editor", path: `${WT}/a.ts` }),
        activeLeafId: "p1",
        paneOrder: ["p1"],
        cwd: WT,
      },
    ];
    // An open editor is not a running agent.
    expect(worktreeSessionStatus(tabs, { p1: "active" }, {}, WT, false).status).toBeNull();
  });
});
