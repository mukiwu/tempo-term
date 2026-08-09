import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { SettingsView } from "@/modules/settings/SettingsView";
import { useUiStore } from "@/stores/uiStore";
import { useOverlayGuard } from "@/lib/overlayGuard";
import { BackgroundImagePreviewPanel } from "@/modules/settings/BackgroundImagePreviewPanel";
import { useBackgroundImageDraftStore } from "@/stores/backgroundImageDraftStore";

export function SettingsModal() {
  const { t } = useTranslation();
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);
  const previewActive = useBackgroundImageDraftStore((s) => s.previewActive);
  const cancelBackgroundDraft = useBackgroundImageDraftStore((s) => s.cancel);
  const leaveBackgroundPreview = useBackgroundImageDraftStore((s) => s.leavePreview);
  const close = () => {
    cancelBackgroundDraft();
    setSettingsOpen(false);
  };

  // This modal is only mounted while open, so hide the native preview webview
  // (which floats above all DOM) for as long as it is on screen.
  useOverlayGuard(!previewActive);

  // Esc closes the modal, matching the other dialogs in the app. The Zustand
  // setter is a stable reference, so the listener binds once.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (useBackgroundImageDraftStore.getState().previewActive) {
          leaveBackgroundPreview();
        } else {
          cancelBackgroundDraft();
          setSettingsOpen(false);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cancelBackgroundDraft, leaveBackgroundPreview, setSettingsOpen]);

  // close() and Escape both drop the background draft, but they are not the
  // only ways out: AboutSettingsSection closes settings to go elsewhere, and
  // anything else flipping settingsOpen from outside skips them entirely. A
  // draft left behind reopens holding last session's unapplied edits, and one
  // left mid-preview keeps previewActive true with no panel on screen to leave
  // it — the whole shell then renders someone's abandoned preview. Unmount is
  // the one point every exit passes through.
  useEffect(() => {
    return () => useBackgroundImageDraftStore.getState().cancel();
  }, []);

  if (previewActive) {
    return (
      <div
        data-testid="background-live-preview-layer"
        className="pointer-events-none fixed inset-0 z-50"
      >
        <BackgroundImagePreviewPanel />
      </div>
    );
  }

  return (
    <div
      // Clicking the dimmed area beside the panel dismisses it; clicks that
      // originate inside the panel bubble up here with a different target, so
      // guard on currentTarget to leave those alone.
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          close();
        }
      }}
      data-testid="settings-modal-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
    >
      <div className="relative flex h-[80vh] w-full max-w-4xl overflow-hidden rounded-xl border border-border-strong bg-bg shadow-2xl">
        <button
          type="button"
          aria-label={t("actions.cancel")}
          onClick={close}
          className="absolute right-3 top-3 z-10 rounded p-1 text-fg-muted hover:bg-bg-elevated hover:text-fg"
        >
          <X size={18} />
        </button>
        <SettingsView />
      </div>
    </div>
  );
}
