import { describe, expect, it } from "vitest";
import { localTerminalCwd } from "./panes";

describe("localTerminalCwd", () => {
  it("takes the pane's own live directory", () => {
    expect(localTerminalCwd({ kind: "terminal", cwd: "/a" }, "/b")).toBe("/a");
  });

  it("falls back to the tab's starting dir for a pane that has not reported yet", () => {
    expect(localTerminalCwd({ kind: "terminal" }, "/b")).toBe("/b");
  });

  it("gives no local directory for an SSH pane, whose shell is on another host", () => {
    expect(localTerminalCwd({ kind: "terminal", cwd: "/a", ssh: { connectionId: "c1" } }, "/b")).toBeNull();
  });

  it("gives no local directory for an SSH pane borrowing the tab's dir either", () => {
    // The trap: `ssh` is a flag on ordinary terminal content, and an SSH pane
    // split into a tab that sits in a worktree inherits that tab's cwd.
    expect(localTerminalCwd({ kind: "terminal", ssh: { connectionId: "c1" } }, "/worktree")).toBeNull();
  });

  it("ignores panes that are not terminals", () => {
    expect(localTerminalCwd({ kind: "editor", path: "/a/f.ts" }, "/b")).toBeNull();
    expect(localTerminalCwd({ kind: "launcher" }, "/b")).toBeNull();
    expect(localTerminalCwd(undefined, "/b")).toBeNull();
  });

  it("has no answer when neither the pane nor its tab knows where it is", () => {
    expect(localTerminalCwd({ kind: "terminal" }, undefined)).toBeNull();
  });
});
