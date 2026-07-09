import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/i18n";
import { SettingsView } from "./SettingsView";
import { useUiStore } from "@/stores/uiStore";

// Every settings section pulls in its own Tauri/store dependencies (invoke,
// openUrl, secretsHasKey, ...); stub them all so this test stays focused on
// SettingsView's own nav + section-switching logic.
vi.mock("./FontsSettingsSection", () => ({
  FontsSettingsSection: () => <div data-testid="section-fonts" />,
}));
vi.mock("./TerminalSettingsSection", () => ({
  TerminalSettingsSection: () => <div data-testid="section-terminal" />,
}));
vi.mock("./AiSettingsSection", () => ({
  AiSettingsSection: () => <div data-testid="section-ai" />,
}));
vi.mock("./WorkspaceSettingsSection", () => ({
  WorkspaceSettingsSection: () => <div data-testid="section-workspace" />,
}));
vi.mock("./ShortcutsSettingsSection", () => ({
  ShortcutsSettingsSection: () => <div data-testid="section-shortcuts" />,
}));
vi.mock("./AboutSettingsSection", () => ({
  AboutSettingsSection: () => <div data-testid="section-about" />,
}));

// Snapshot the store (actions included) at load so each test starts from a
// complete, clean state rather than only resetting the fields we touch.
const initialUiState = useUiStore.getState();

beforeEach(() => {
  useUiStore.setState(initialUiState, true);
});

describe("SettingsView section deep-link", () => {
  it("opens at the section requested via uiStore", () => {
    useUiStore.setState({ settingsOpen: true, settingsSection: "about" });
    render(<SettingsView />);

    expect(screen.getByRole("button", { name: "About" })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(screen.getByRole("button", { name: "Appearance" })).toHaveAttribute(
      "aria-current",
      "false",
    );
    expect(screen.getByTestId("section-about")).toBeInTheDocument();
  });

  it("falls back to Appearance when no section was requested", () => {
    render(<SettingsView />);

    expect(screen.getByRole("button", { name: "Appearance" })).toHaveAttribute(
      "aria-current",
      "true",
    );
  });

  it("clears the requested section after consuming it, so a later plain open doesn't replay it", () => {
    useUiStore.setState({ settingsOpen: true, settingsSection: "shortcuts" });
    render(<SettingsView />);

    expect(useUiStore.getState().settingsSection).toBeNull();
  });

  it("falls back to Appearance for an unknown section id", () => {
    useUiStore.setState({ settingsOpen: true, settingsSection: "not-a-real-section" });
    render(<SettingsView />);

    expect(screen.getByRole("button", { name: "Appearance" })).toHaveAttribute(
      "aria-current",
      "true",
    );
  });

  it("reacts to a deep-link that arrives while the modal is already mounted", () => {
    // Modal is already open on the default section (e.g. the user is looking
    // at Appearance) when a second deep-link comes in, without unmounting.
    useUiStore.setState({ settingsOpen: true, settingsSection: null });
    render(<SettingsView />);
    expect(screen.getByRole("button", { name: "Appearance" })).toHaveAttribute(
      "aria-current",
      "true",
    );

    // e.g. Help > Keyboard Shortcuts clicked while settings are already showing.
    act(() => {
      useUiStore.getState().openSettings("shortcuts");
    });

    expect(screen.getByRole("button", { name: "Shortcuts" })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(screen.getByRole("button", { name: "Appearance" })).toHaveAttribute(
      "aria-current",
      "false",
    );
  });

  it("consumes and clears a stuck section value instead of replaying it on the next plain open", () => {
    // Simulate a value left stuck in the store from a prior deep-link that
    // was never consumed (the bug this regression test guards against).
    useUiStore.setState({ settingsSection: "shortcuts" });
    const { unmount } = render(<SettingsView />);

    expect(screen.getByRole("button", { name: "Shortcuts" })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(useUiStore.getState().settingsSection).toBeNull();

    unmount();

    // A later bypass open (Cmd+, / gear icon) sets settingsOpen directly with
    // no section — it must not replay the stale "shortcuts" value.
    useUiStore.setState({ settingsOpen: true });
    render(<SettingsView />);

    expect(screen.getByRole("button", { name: "Appearance" })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(screen.getByRole("button", { name: "Shortcuts" })).toHaveAttribute(
      "aria-current",
      "false",
    );
  });
});
