import { describe, expect, it } from "vitest";
import { isClaudeForeground, isCodexForeground, isTrackedAgentForeground, parseStatusOsc } from "./sessionStatus";

describe("parseStatusOsc", () => {
  it("parses a status payload", () => {
    expect(parseStatusOsc("tempoterm;status;active")).toEqual({
      kind: "status",
      status: "active",
    });
    expect(parseStatusOsc("tempoterm;status;waiting-approval")).toEqual({
      kind: "status",
      status: "waiting-approval",
    });
  });

  it("parses an end payload", () => {
    expect(parseStatusOsc("tempoterm;status;end")).toEqual({ kind: "end" });
  });

  it("ignores payloads without the tempoterm prefix", () => {
    expect(parseStatusOsc("something;else")).toBeNull();
  });

  it("ignores unknown states", () => {
    expect(parseStatusOsc("tempoterm;status;bogus")).toBeNull();
  });

  it("maps a permission notification to waiting-approval", () => {
    expect(parseStatusOsc("tempoterm;notify;permission_prompt")).toEqual({
      kind: "status",
      status: "waiting-approval",
    });
  });

  it("maps an idle notification to idle, not waiting-approval", () => {
    // The idle prompt means Claude is just waiting for the user's next message;
    // it must not light the "waiting for approval" badge.
    expect(parseStatusOsc("tempoterm;notify;idle_prompt")).toEqual({
      kind: "status",
      status: "idle",
    });
  });

  it("ignores notification types that don't map to a session state", () => {
    // e.g. auth_success / elicitation — these should never clobber the status.
    expect(parseStatusOsc("tempoterm;notify;auth_success")).toBeNull();
    expect(parseStatusOsc("tempoterm;notify;")).toBeNull();
  });

  it("ignores prototype keys that resolve to inherited Object members", () => {
    // A stray OSC must not look up "toString"/"constructor" and return an
    // inherited function as the status.
    expect(parseStatusOsc("tempoterm;notify;toString")).toBeNull();
    expect(parseStatusOsc("tempoterm;notify;constructor")).toBeNull();
  });
});

describe("isClaudeForeground", () => {
  it("matches the claude binary, by name or path", () => {
    expect(isClaudeForeground("claude")).toBe(true);
    expect(isClaudeForeground("/Users/me/.local/bin/claude")).toBe(true);
    expect(isClaudeForeground("node /opt/homebrew/lib/node_modules/@anthropic-ai/claude-code/cli.js")).toBe(
      true,
    );
  });

  it("matches claude run behind a prefix runner", () => {
    expect(isClaudeForeground("sudo claude")).toBe(true);
    expect(isClaudeForeground("npx claude")).toBe(true);
  });

  it("does not match a plain shell or other commands", () => {
    expect(isClaudeForeground("zsh")).toBe(false);
    expect(isClaudeForeground("-zsh")).toBe(false);
    expect(isClaudeForeground("node server.js")).toBe(false);
    expect(isClaudeForeground(null)).toBe(false);
    expect(isClaudeForeground("")).toBe(false);
  });

  it("does not match claude only appearing as an argument", () => {
    expect(isClaudeForeground("vim claude.md")).toBe(false);
    expect(isClaudeForeground("cat claude.log")).toBe(false);
  });
});

describe("isCodexForeground", () => {
  it("matches the codex binary by name, path, and prefix runners", () => {
    expect(isCodexForeground("codex")).toBe(true);
    expect(isCodexForeground("/Users/me/.nvm/versions/node/v22.15.1/bin/codex")).toBe(true);
    expect(isCodexForeground("node /opt/homebrew/lib/node_modules/@openai/codex/cli.js")).toBe(true);
    expect(isCodexForeground("node /usr/local/lib/node_modules/openai-codex/cli.js")).toBe(true);
    expect(isCodexForeground("npx codex")).toBe(true);
  });
  it("does not match a shell or codex as a mere argument", () => {
    expect(isCodexForeground("zsh")).toBe(false);
    expect(isCodexForeground("vim codex.md")).toBe(false);
    expect(isCodexForeground(null)).toBe(false);
  });
});

describe("isTrackedAgentForeground", () => {
  it("is true for either claude or codex", () => {
    expect(isTrackedAgentForeground("claude")).toBe(true);
    expect(isTrackedAgentForeground("codex")).toBe(true);
    expect(isTrackedAgentForeground("zsh")).toBe(false);
  });
});
