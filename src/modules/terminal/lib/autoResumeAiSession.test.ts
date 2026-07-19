import { beforeEach, describe, expect, it } from "vitest";
import {
  releaseAutoResumeAttempt,
  resetAutoResumeAttempts,
  sessionEndMatchesBinding,
  tabHasAutoResumeSession,
  takeAutoResumeCommand,
} from "./autoResumeAiSession";
import { leaf } from "./terminalLayout";
import type { Tab } from "@/stores/tabsStore";

beforeEach(resetAutoResumeAttempts);

describe("takeAutoResumeCommand", () => {
  it("returns each pane/session's exact command only once per process", () => {
    const session = { agent: "claude" as const, sessionId: "session-123" };
    expect(takeAutoResumeCommand("leaf-1", session, true)).toBe(
      "claude --resume session-123",
    );
    expect(takeAutoResumeCommand("leaf-1", session, true)).toBeNull();
    expect(takeAutoResumeCommand("leaf-2", session, true)).toBe(
      "claude --resume session-123",
    );
  });

  it("does nothing when disabled or when the id is unsafe", () => {
    expect(
      takeAutoResumeCommand(
        "leaf-1",
        { agent: "codex", sessionId: "session-123" },
        false,
      ),
    ).toBeNull();
    expect(
      takeAutoResumeCommand(
        "leaf-1",
        { agent: "codex", sessionId: "bad;command" },
        true,
      ),
    ).toBeNull();
  });

  it("can retry after the pane owning an attempt unmounts", () => {
    const session = { agent: "codex" as const, sessionId: "session-123" };
    expect(takeAutoResumeCommand("leaf-1", session, true)).toBe(
      "codex resume session-123",
    );
    releaseAutoResumeAttempt("leaf-1", session);
    expect(takeAutoResumeCommand("leaf-1", session, true)).toBe(
      "codex resume session-123",
    );
  });
});

describe("sessionEndMatchesBinding", () => {
  const current = { agent: "claude" as const, sessionId: "session-new" };

  it("accepts the current or an uncorrelated legacy SessionEnd", () => {
    expect(sessionEndMatchesBinding(current, "session-new", "claude")).toBe(true);
    expect(sessionEndMatchesBinding(current, undefined, undefined)).toBe(true);
  });

  it("rejects a delayed SessionEnd from a replaced conversation", () => {
    expect(sessionEndMatchesBinding(current, "session-old", "claude")).toBe(false);
    expect(sessionEndMatchesBinding(current, "session-new", "codex")).toBe(false);
  });
});

describe("tabHasAutoResumeSession", () => {
  it("finds local AI panes but ignores SSH terminals", () => {
    const base: Omit<Tab, "paneTree"> = {
      id: "tab-1",
      spaceId: "space-1",
      title: "Terminal",
      kind: "terminal",
      activeLeafId: "leaf-1",
      paneOrder: ["leaf-1"],
    };
    expect(
      tabHasAutoResumeSession({
        ...base,
        paneTree: leaf("leaf-1", {
          kind: "terminal",
          aiSession: { agent: "codex", sessionId: "session-123" },
        }),
      }),
    ).toBe(true);
    expect(
      tabHasAutoResumeSession({
        ...base,
        paneTree: leaf("leaf-1", {
          kind: "terminal",
          ssh: { connectionId: "remote" },
          aiSession: { agent: "codex", sessionId: "session-123" },
        }),
      }),
    ).toBe(false);
  });
});
