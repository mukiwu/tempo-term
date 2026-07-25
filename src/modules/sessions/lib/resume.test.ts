import { beforeEach, describe, expect, it } from "vitest";
import { resumeCommand, resumeSession } from "./resume";
import { resumeFlagsFor } from "./resumeCommand";
import type { SessionSummary } from "./sessionsBridge";
import { useTabsStore } from "@/stores/tabsStore";
import { useSettingsStore } from "@/stores/settingsStore";
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

  it("appends launcher flags after the resume command", () => {
    expect(resumeCommand("claude", "abc-123", "--dangerously-skip-permissions")).toBe(
      "claude --resume abc-123 --dangerously-skip-permissions",
    );
    expect(resumeCommand("codex", "abc-123", "-s workspace-write")).toBe(
      "codex resume abc-123 -s workspace-write",
    );
  });

  it("ignores blank flags and keeps the command newline-free", () => {
    expect(resumeCommand("claude", "abc-123", "   ")).toBe("claude --resume abc-123");
    // The command is submitted with a single trailing \r; a newline smuggled
    // into the flags would split it into a second submitted command.
    expect(resumeCommand("claude", "abc-123", "--verbose\nrm -rf /")).toBe(
      "claude --resume abc-123 --verbose rm -rf /",
    );
  });
});

describe("resumeFlagsFor", () => {
  const settings = { resumeWithLauncherFlags: true, claudeFlags: "--a", codexFlags: "--b" };

  it("picks the agent's launcher flags when the setting is on", () => {
    expect(resumeFlagsFor("claude", settings)).toBe("--a");
    expect(resumeFlagsFor("codex", settings)).toBe("--b");
  });

  it("returns nothing when the setting is off or the agent is unknown", () => {
    expect(resumeFlagsFor("claude", { ...settings, resumeWithLauncherFlags: false })).toBe("");
    expect(resumeFlagsFor("antigravity", settings)).toBe("");
    expect(resumeFlagsFor(undefined, settings)).toBe("");
  });
});

describe("resumeSession", () => {
  beforeEach(() => {
    useTabsStore.setState({ tabs: [], activeId: null, spaces: [], activeSpaceId: null });
    useSettingsStore.setState({
      resumeWithLauncherFlags: false,
      claudeFlags: "",
      codexFlags: "",
    });
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
    expect(writes).toEqual(["claude --resume sess-1\r"]);
    unregisterTerminal(tab.activeLeafId);
  });

  it("builds the codex resume command for a codex session", () => {
    resumeSession(session({ agent: "codex", id: "sess-2", project_cwd: "/repo" }));
    const tab = useTabsStore.getState().tabs[0];
    const writes: string[] = [];
    registerTerminal(tab.activeLeafId, (text) => writes.push(text));
    expect(writes).toEqual(["codex resume sess-2\r"]);
    unregisterTerminal(tab.activeLeafId);
  });

  it("appends the agent's launcher flags when resume-with-flags is enabled", () => {
    useSettingsStore.setState({
      resumeWithLauncherFlags: true,
      claudeFlags: "--dangerously-skip-permissions",
      codexFlags: "--sandbox workspace-write",
    });

    resumeSession(session({ agent: "claude", id: "sess-3", project_cwd: "/repo" }));
    const tab = useTabsStore.getState().tabs[0];
    const writes: string[] = [];
    registerTerminal(tab.activeLeafId, (text) => writes.push(text));
    expect(writes).toEqual(["claude --resume sess-3 --dangerously-skip-permissions\r"]);
    unregisterTerminal(tab.activeLeafId);
  });
});
