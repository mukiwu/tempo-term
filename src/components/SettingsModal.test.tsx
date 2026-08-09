import { render, screen, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@/i18n";
import { SettingsModal } from "./SettingsModal";
import { useUiStore } from "@/stores/uiStore";
import { useBackgroundImageDraftStore } from "@/stores/backgroundImageDraftStore";

// The settings body is a separate concern (and pulls in the whole settings UI);
// stub it so this test stays focused on the modal chrome's close behavior.
vi.mock("@/modules/settings/SettingsView", () => ({
  SettingsView: () => <div data-testid="settings-body">settings</div>,
}));

describe("SettingsModal", () => {
  beforeEach(() => {
    useUiStore.setState({ settingsOpen: true });
    useBackgroundImageDraftStore.getState().cancel();
  });

  afterEach(() => {
    useUiStore.setState({ settingsOpen: false });
  });

  it("closes when Escape is pressed", () => {
    render(<SettingsModal />);

    fireEvent.keyDown(document.body, { key: "Escape" });

    expect(useUiStore.getState().settingsOpen).toBe(false);
  });

  it("closes when the backdrop behind the panel is clicked", () => {
    render(<SettingsModal />);

    fireEvent.click(screen.getByTestId("settings-modal-backdrop"));

    expect(useUiStore.getState().settingsOpen).toBe(false);
  });

  it("stays open when a click lands inside the panel", () => {
    render(<SettingsModal />);

    fireEvent.click(screen.getByTestId("settings-body"));

    expect(useUiStore.getState().settingsOpen).toBe(true);
  });

  it("Escape returns from live preview and preserves the draft", () => {
    useBackgroundImageDraftStore.getState().begin({
      path: "/pictures/draft.png",
      opacity: 40,
      terminalOpacity: 50,
      scope: "workspace",
      textColor: null,
    });
    useBackgroundImageDraftStore.getState().enterPreview();
    render(<SettingsModal />);

    expect(screen.getByTestId("background-live-preview-layer")).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "Escape" });

    expect(useUiStore.getState().settingsOpen).toBe(true);
    expect(useBackgroundImageDraftStore.getState().previewActive).toBe(false);
    expect(useBackgroundImageDraftStore.getState().draft?.path).toBe(
      "/pictures/draft.png",
    );
  });

  it("keeps the workspace click-through while the preview controls can collapse", () => {
    useBackgroundImageDraftStore.getState().begin({
      path: "/pictures/draft.png",
      opacity: 40,
      terminalOpacity: 50,
      scope: "workspace",
      textColor: null,
    });
    useBackgroundImageDraftStore.getState().enterPreview();
    render(<SettingsModal />);

    expect(screen.getByTestId("background-live-preview-layer")).toHaveClass(
      "pointer-events-none",
    );
    expect(screen.getByTestId("background-preview-panel")).toHaveClass(
      "pointer-events-auto",
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Collapse preview controls" }),
    );
    expect(screen.getByTestId("background-preview-panel-collapsed")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Live preview/ }));
    expect(screen.getByTestId("background-preview-panel")).toBeInTheDocument();
  });

  it("drops the background draft when settings close without going through close() or Escape", () => {
    useBackgroundImageDraftStore.getState().begin({
      path: "/pictures/draft.png",
      opacity: 40,
      terminalOpacity: 50,
      scope: "workspace",
      textColor: null,
    });
    const { unmount } = render(<SettingsModal />);

    // What AboutSettingsSection does: flip the store and let App unmount us.
    useUiStore.getState().setSettingsOpen(false);
    unmount();

    expect(useBackgroundImageDraftStore.getState().draft).toBeNull();
  });

  it("leaves live preview when the modal unmounts mid-preview", () => {
    useBackgroundImageDraftStore.getState().begin({
      path: "/pictures/draft.png",
      opacity: 40,
      terminalOpacity: 50,
      scope: "workspace",
      textColor: null,
    });
    useBackgroundImageDraftStore.getState().enterPreview();
    const { unmount } = render(<SettingsModal />);

    unmount();

    // Otherwise useBackgroundImage keeps serving the draft to the whole shell,
    // with no panel left on screen to get out of it.
    expect(useBackgroundImageDraftStore.getState().previewActive).toBe(false);
  });
});
