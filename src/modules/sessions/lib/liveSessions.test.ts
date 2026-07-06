import { describe, expect, it } from "vitest";
import type { Tab } from "@/stores/tabsStore";
import { leaf, type LayoutNode } from "@/modules/terminal/lib/terminalLayout";
import { deriveLiveSessions } from "./liveSessions";

function tabWith(id: string, title: string, paneTree: LayoutNode, cwd?: string): Tab {
  return {
    id,
    spaceId: "space-1",
    title,
    kind: "terminal",
    paneTree,
    activeLeafId: "irrelevant",
    paneOrder: [],
    cwd,
  };
}

describe("deriveLiveSessions", () => {
  it("returns only the tab whose pane has a live status, with the right tab/leaf ids", () => {
    const liveTab = tabWith("tab-live", "Live Tab", leaf("L1", { kind: "terminal", cwd: "/pane-cwd" }));
    const idleTab = tabWith("tab-idle", "Idle Tab", leaf("L2", { kind: "terminal" }));

    const result = deriveLiveSessions(
      [liveTab, idleTab],
      { L1: "thinking" },
      { L1: "claude" },
    );

    expect(result).toEqual([
      {
        tabId: "tab-live",
        leafId: "L1",
        tabTitle: "Live Tab",
        agent: "claude",
        status: "thinking",
        cwd: "/pane-cwd",
      },
    ]);
  });

  it("falls back to the tab's cwd when the pane has not reported its own", () => {
    const tab = tabWith("tab-1", "Tab", leaf("L1", { kind: "terminal" }), "/tab-cwd");

    const [session] = deriveLiveSessions([tab], { L1: "active" }, { L1: "codex" });

    expect(session.cwd).toBe("/tab-cwd");
  });

  it("falls back to null when neither the pane nor the tab has a cwd", () => {
    const tab = tabWith("tab-1", "Tab", leaf("L1", { kind: "terminal" }));

    const [session] = deriveLiveSessions([tab], { L1: "active" }, { L1: "codex" });

    expect(session.cwd).toBeNull();
  });

  it("ignores non-terminal panes even if a status happens to be keyed under their id", () => {
    const tree: LayoutNode = {
      kind: "split",
      direction: "row",
      sizes: [0.5, 0.5],
      children: [
        { kind: "leaf", id: "L1", pane: { kind: "terminal" } },
        { kind: "leaf", id: "E1", pane: { kind: "editor", path: "/a.ts" } },
      ],
    };
    const tab = tabWith("tab-1", "Tab", tree);

    const result = deriveLiveSessions([tab], { E1: "active" }, {});

    expect(result).toEqual([]);
  });

  it("includes a session whose agent has not yet been classified", () => {
    const tab = tabWith("tab-1", "Tab", leaf("L1", { kind: "terminal" }), "/tab-cwd");

    const [session] = deriveLiveSessions([tab], { L1: "idle" }, {});

    expect(session.agent).toBeUndefined();
    expect(session.status).toBe("idle");
  });

  it("returns an empty array when no tab has a live status", () => {
    const tab = tabWith("tab-1", "Tab", leaf("L1", { kind: "terminal" }));

    expect(deriveLiveSessions([tab], {}, {})).toEqual([]);
  });
});
