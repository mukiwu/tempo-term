import { describe, expect, it } from "vitest";
import { buildLauncherCommand } from "./launcherCommand";

describe("buildLauncherCommand", () => {
  it("appends the configured flags to the base command", () => {
    expect(buildLauncherCommand("claude", "--model opus")).toBe("claude --model opus");
  });

  it("returns the bare base command when no flags are set", () => {
    expect(buildLauncherCommand("claude", "")).toBe("claude");
    expect(buildLauncherCommand("codex", "   ")).toBe("codex");
  });

  it("trims surrounding whitespace around the flags", () => {
    expect(buildLauncherCommand("claude", "  --resume  ")).toBe("claude --resume");
  });
});
