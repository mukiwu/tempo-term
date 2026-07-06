import { beforeEach, describe, expect, it } from "vitest";
import { resumeCommand, resumeSession } from "./resume";
import type { SessionSummary } from "./sessionsBridge";
import { useTabsStore } from "@/stores/tabsStore";
import { registerTerminal, unregisterTerminal } from "@/modules/terminal/lib/terminalBus";

function session(overrides: Partial<SessionSummary>): SessionSummary {
  return {
    id: "abc-123",
    agent: "claude",
    project_cwd: "/Users/muki/project",
    title: "Untitled",
    started_at: 0,
    ended_at: 0,
    message_count: 0,
    user_message_count: 0,
    output_tokens: null,
    model: null,
    file_path: "/tmp/session.jsonl",
    pinned: false,
    ...overrides,
  };
}

describe("resumeCommand", () => {
  it("builds the claude resume command", () => {
    expect(resumeCommand("claude", "abc-123")).toBe("claude --resume abc-123");
  });

  it("builds the codex resume command", () => {
    expect(resumeCommand("codex", "abc-123")).toBe("codex resume abc-123");
  });

  it("returns null for antigravity — no verified CLI resume flag", () => {
    expect(resumeCommand("antigravity", "abc-123")).toBeNull();
  });

  it("rejects a session id that doesn't match the shell-safe id guard", () => {
    expect(resumeCommand("claude", "abc-123; rm -rf /")).toBeNull();
    expect(resumeCommand("claude", "abc 123")).toBeNull();
    expect(resumeCommand("claude", "$(whoami)")).toBeNull();
  });
});

describe("resumeSession", () => {
  beforeEach(() => {
    useTabsStore.setState({ tabs: [], activeId: null, spaces: [], activeSpaceId: null });
  });

  it("returns false and opens no tab when the agent has no resume command", () => {
    const before = useTabsStore.getState().tabs.length;
    const result = resumeSession(session({ agent: "antigravity" }));
    expect(result).toBe(false);
    expect(useTabsStore.getState().tabs.length).toBe(before);
  });

  it("opens a new terminal tab at the session's project cwd and writes the resume command", () => {
    const result = resumeSession(
      session({ agent: "claude", id: "sess-1", project_cwd: "/Users/muki/my-app" }),
    );
    expect(result).toBe(true);

    const tabs = useTabsStore.getState().tabs;
    expect(tabs).toHaveLength(1);
    const tab = tabs[0];
    expect(tab.kind).toBe("terminal");
    expect(tab.cwd).toBe("/Users/muki/my-app");

    // The PTY hasn't registered yet in this test, so the write sits queued —
    // registering flushes it, proving `writeToTerminal` reached the right leaf.
    const writes: string[] = [];
    registerTerminal(tab.activeLeafId, (text) => writes.push(text));
    expect(writes).toEqual(["claude --resume sess-1\n"]);
    unregisterTerminal(tab.activeLeafId);
  });

  it("builds the codex resume command for a codex session", () => {
    resumeSession(session({ agent: "codex", id: "sess-2", project_cwd: "/repo" }));
    const tab = useTabsStore.getState().tabs[0];
    const writes: string[] = [];
    registerTerminal(tab.activeLeafId, (text) => writes.push(text));
    expect(writes).toEqual(["codex resume sess-2\n"]);
    unregisterTerminal(tab.activeLeafId);
  });
});
