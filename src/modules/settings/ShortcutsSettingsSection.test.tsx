import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/i18n";

vi.mock("@/lib/platform", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/platform")>();
  return { ...actual, IS_MAC: true, IS_WINDOWS: false };
});

import { ShortcutsSettingsSection } from "./ShortcutsSettingsSection";
import { useSettingsStore } from "@/stores/settingsStore";
import { useUiStore } from "@/stores/uiStore";

beforeEach(() => {
  useSettingsStore.setState({ keybindings: {}, globalHotkey: null });
  useUiStore.setState({ recordingShortcut: false });
});

const recordButton = () =>
  screen.getByRole("button", { name: "Change the shortcut for New terminal tab" });

describe("ShortcutsSettingsSection recording", () => {
  it("records a new chord and offers to restore the default", () => {
    render(<ShortcutsSettingsSection />);
    expect(recordButton()).toHaveTextContent("⌘T");

    fireEvent.click(recordButton());
    expect(recordButton()).toHaveTextContent("Press keys…");
    expect(useUiStore.getState().recordingShortcut).toBe(true);

    fireEvent.keyDown(window, { code: "KeyY", key: "y", metaKey: true, shiftKey: true });
    expect(useSettingsStore.getState().keybindings).toEqual({ "new-terminal-tab": "Mod+Shift+KeyY" });
    expect(recordButton()).toHaveTextContent("⇧⌘Y");
    expect(useUiStore.getState().recordingShortcut).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Restore the default shortcut for New terminal tab" }));
    expect(useSettingsStore.getState().keybindings).toEqual({});
  });

  it("refuses a chord another command uses and cancels on Escape", () => {
    render(<ShortcutsSettingsSection />);
    fireEvent.click(recordButton());
    fireEvent.keyDown(window, { code: "KeyW", key: "w", metaKey: true });
    expect(screen.getByText(/Already used by/)).toBeInTheDocument();
    expect(useSettingsStore.getState().keybindings).toEqual({});

    fireEvent.keyDown(window, { code: "KeyC", key: "c", metaKey: true });
    expect(screen.getByText("Reserved for a built-in shortcut")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape", code: "Escape" });
    expect(recordButton()).toHaveTextContent("⌘T");
  });
});

describe("ShortcutsSettingsSection global hotkey", () => {
  it("is off until a chord is recorded, and can be turned off again", () => {
    render(<ShortcutsSettingsSection />);
    const button = () =>
      screen.getByRole("button", { name: "Change the shortcut for Show or hide TempoTerm" });
    expect(button()).toHaveTextContent("Off");

    fireEvent.click(button());
    fireEvent.keyDown(window, { code: "Space", key: " ", metaKey: true, shiftKey: true });
    expect(useSettingsStore.getState().globalHotkey).toBe("Mod+Shift+Space");
    expect(button()).toHaveTextContent("⇧⌘Space");

    fireEvent.click(
      screen.getByRole("button", { name: "Restore the default shortcut for Show or hide TempoTerm" }),
    );
    expect(useSettingsStore.getState().globalHotkey).toBeNull();
  });

  it("refuses a chord a command already uses", () => {
    render(<ShortcutsSettingsSection />);
    fireEvent.click(
      screen.getByRole("button", { name: "Change the shortcut for Show or hide TempoTerm" }),
    );
    fireEvent.keyDown(window, { code: "KeyT", key: "t", metaKey: true });
    expect(screen.getByText(/Already used by/)).toBeInTheDocument();
    expect(useSettingsStore.getState().globalHotkey).toBeNull();
  });
});
