import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@/i18n";
import { LauncherPanel } from "./LauncherPanel";
import { useSettingsStore } from "@/stores/settingsStore";
import { writeToTerminal } from "@/modules/terminal/lib/terminalBus";

vi.mock("@/modules/terminal/lib/terminalBus", () => ({
  writeToTerminal: vi.fn(),
}));

describe("LauncherPanel CLI launch", () => {
  beforeEach(() => {
    cleanup();
    vi.mocked(writeToTerminal).mockClear();
    useSettingsStore.setState({ claudeFlags: "", codexFlags: "" });
  });

  it("launches Claude Code with the configured flags appended", () => {
    useSettingsStore.setState({ claudeFlags: "--model opus" });
    render(<LauncherPanel />);
    fireEvent.click(screen.getByText("Claude Code"));
    expect(writeToTerminal).toHaveBeenCalledWith(expect.any(String), "claude --model opus\n");
  });

  it("launches Codex bare when no flags are configured", () => {
    render(<LauncherPanel />);
    fireEvent.click(screen.getByText("Codex"));
    expect(writeToTerminal).toHaveBeenCalledWith(expect.any(String), "codex\n");
  });
});
