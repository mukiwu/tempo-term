import { render, screen, fireEvent, within } from "@testing-library/react";
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

  it("asks about running programs by default and saves another mode", () => {
    render(<TerminalSettingsSection />);
    const group = screen.getByRole("radiogroup", { name: "Confirm before closing" });
    expect(within(group).getByRole("radio", { name: "Running programs" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    fireEvent.click(within(group).getByRole("radio", { name: "Never" }));
    expect(useSettingsStore.getState().closeConfirm).toBe("never");
  });
});

describe("TerminalSettingsSection copy on select", () => {
  it("is off by default and saves the opt-in", () => {
    render(<TerminalSettingsSection />);
    const checkbox = screen.getByLabelText("Copy on select");
    expect(checkbox).not.toBeChecked();
    fireEvent.click(checkbox);
    expect(useSettingsStore.getState().copyOnSelect).toBe(true);
  });
});

describe("TerminalSettingsSection new tab directory", () => {
  it("starts in the workspace folder and switches to the current directory", () => {
    render(<TerminalSettingsSection />);
    expect(screen.getByRole("radio", { name: "Workspace folder" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("radio", { name: "Current directory" }));
    expect(useSettingsStore.getState().newTabCwd).toBe("current");
  });
});
