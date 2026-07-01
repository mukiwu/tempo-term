import { useEffect } from "react";
import { useOverlayGuard } from "@/lib/overlayGuard";

interface InfoDialogProps {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
}

/**
 * A single-button modal for messages that only need acknowledgement (no
 * confirm/cancel choice) — styled like ConfirmDialog so it matches the rest
 * of the app instead of a native window.alert.
 */
export function InfoDialog({ title, message, confirmLabel, onConfirm }: InfoDialogProps) {
  // Mounted only while open, so guard unconditionally to hide the preview webview.
  useOverlayGuard(true);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Enter") {
        onConfirm();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onConfirm]);

  return (
    <div onPointerDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
      <div className="fixed inset-0 z-[95] bg-black/60" onClick={onConfirm} />
      <div className="fixed left-1/2 top-1/2 z-[100] w-[400px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-bg-elevated shadow-2xl">
        <div className="border-b border-border px-4 py-3">
          <span className="text-sm font-semibold text-fg">{title}</span>
        </div>
        <div className="px-4 py-4 text-sm text-fg-muted">{message}</div>
        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-md bg-accent px-4 py-1.5 text-xs font-medium text-white"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
