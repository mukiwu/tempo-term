import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/i18n";
import { TerminalSettingsSection } from "./TerminalSettingsSection";
import { useSettingsStore } from "@/stores/settingsStore";

vi.mock("@/modules/terminal/lib/terminalHistory", () => ({
  clearTerminalHistory: vi.fn().mockResolvedValue(undefined),
}));

// Snapshot the store (actions included) at load so each test starts from a
// complete, clean state rather than only resetting one field.
const initialState = useSettingsStore.getState();

beforeEach(() => {
  useSettingsStore.setState(initialState, true);
});

describe("TerminalSettingsSection custom shell", () => {
  it("shows the stored custom shell path and writes edits back to the store", () => {
    useSettingsStore.setState({ customShellPath: "/bin/zsh" });
    render(<TerminalSettingsSection />);
    const input = screen.getByLabelText("Custom shell path");
    expect(input).toHaveValue("/bin/zsh");
    fireEvent.change(input, { target: { value: "/opt/homebrew/bin/pwsh" } });
    expect(useSettingsStore.getState().customShellPath).toBe("/opt/homebrew/bin/pwsh");
  });
});
