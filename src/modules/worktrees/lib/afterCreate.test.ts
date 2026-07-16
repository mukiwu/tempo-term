import { describe, expect, it } from "vitest";
import { afterCreateCommand } from "./afterCreate";

describe("afterCreateCommand", () => {
  it("has nothing to say when nothing was asked for", () => {
    expect(afterCreateCommand({})).toBeNull();
  });

  it("runs the setup command the repo remembers", () => {
    expect(afterCreateCommand({ setupCommand: "pnpm install" })).toBe("pnpm install");
  });

  it("starts the agent on its own", () => {
    expect(afterCreateCommand({ agent: "claude" })).toBe("claude");
    expect(afterCreateCommand({ agent: "codex" })).toBe("codex");
  });

  it("waits for setup to succeed before starting the agent", () => {
    // `&&`, not `;`: an agent that starts in a worktree where `pnpm install`
    // just failed is worse than no agent — it starts working against a broken
    // tree and the failure scrolls away above it.
    expect(afterCreateCommand({ setupCommand: "pnpm install", agent: "claude" })).toBe(
      "pnpm install && claude",
    );
  });

  it("ignores a setup command that is only whitespace", () => {
    expect(afterCreateCommand({ setupCommand: "   ", agent: "claude" })).toBe("claude");
    expect(afterCreateCommand({ setupCommand: "  " })).toBeNull();
  });

  it("refuses a setup command carrying its own newline", () => {
    // The command is written into a live pty. A newline in it would submit
    // whatever follows as a second command the user never saw in the field.
    expect(afterCreateCommand({ setupCommand: "pnpm install\nrm -rf /" })).toBeNull();
    expect(afterCreateCommand({ setupCommand: "pnpm install\rrm -rf /" })).toBeNull();
  });
});
