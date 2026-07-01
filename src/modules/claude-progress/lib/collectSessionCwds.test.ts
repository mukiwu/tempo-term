import { describe, expect, it } from "vitest";
import type { Tab } from "@/stores/tabsStore";
import { leaf, splitLeaf } from "@/modules/terminal/lib/terminalLayout";
import { collectSessionCwds } from "./collectSessionCwds";

function terminalTab(overrides: Partial<Tab> = {}): Tab {
  return {
    id: "t1",
    spaceId: "s1",
    title: "Terminal",
    kind: "terminal",
    paneTree: leaf("a", { kind: "terminal" }),
    activeLeafId: "a",
    paneOrder: ["a"],
    ...overrides,
  };
}

describe("collectSessionCwds", () => {
  it("watches a pane's live cwd, not just the tab's initial cwd", () => {
    // The pane has cd'd to a new directory; its live cwd was saved on the pane.
    const tab = terminalTab({
      cwd: "/initial/tab/dir",
      paneTree: leaf("a", { kind: "terminal", cwd: "/where/i/cded" }),
    });
    expect(collectSessionCwds([tab])).toEqual(["/where/i/cded"]);
  });

  it("falls back to the tab's initial cwd when a pane has no live cwd yet", () => {
    // A freshly spawned pane has not polled its shell yet, so pane.cwd is unset.
    const tab = terminalTab({
      cwd: "/initial/tab/dir",
      paneTree: leaf("a", { kind: "terminal" }),
    });
    expect(collectSessionCwds([tab])).toEqual(["/initial/tab/dir"]);
  });

  it("collects the live cwd of every terminal pane across a split", () => {
    const tree = splitLeaf(
      leaf("a", { kind: "terminal", cwd: "/pane/a" }),
      "a",
      "row",
      "b",
      { kind: "terminal", cwd: "/pane/b" },
    );
    const tab = terminalTab({ cwd: "/tab/dir", paneTree: tree });
    expect(collectSessionCwds([tab]).sort()).toEqual(["/pane/a", "/pane/b"]);
  });

  it("dedupes directories shared by multiple panes", () => {
    const tree = splitLeaf(
      leaf("a", { kind: "terminal", cwd: "/same/dir" }),
      "a",
      "row",
      "b",
      { kind: "terminal", cwd: "/same/dir" },
    );
    const tab = terminalTab({ cwd: "/tab/dir", paneTree: tree });
    expect(collectSessionCwds([tab])).toEqual(["/same/dir"]);
  });

  it("ignores non-terminal panes", () => {
    const tab = terminalTab({
      cwd: "/tab/dir",
      paneTree: leaf("a", { kind: "editor", path: "/some/file.ts" }),
    });
    expect(collectSessionCwds([tab])).toEqual([]);
  });

  it("skips terminal panes with no resolvable cwd", () => {
    const tab = terminalTab({ cwd: undefined, paneTree: leaf("a", { kind: "terminal" }) });
    expect(collectSessionCwds([tab])).toEqual([]);
  });
});
