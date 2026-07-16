import { useEffect, type ReactNode } from "react";
import { useOverlayGuard } from "@/lib/overlayGuard";

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** Shown in red under the message when a confirm attempt failed, so the
   *  dialog can stay open and report the error in place rather than the caller
   *  surfacing it elsewhere. */
  error?: string;
  /** Extra content between the message and the buttons — the checkboxes a
   *  destructive action needs the user to tick before it will go through. */
  children?: ReactNode;
  /** Holds the confirm button shut. For an action that needs something ticked
   *  first, so the button says "not yet" rather than the click doing nothing. */
  confirmDisabled?: boolean;
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  error,
  children,
  confirmDisabled,
}: ConfirmDialogProps) {
  // Mounted only while open, so guard unconditionally to hide the preview webview.
  useOverlayGuard(true);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCancel();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  return (
    <div onPointerDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
      <div className="fixed inset-0 z-[95] bg-black/60" onClick={onCancel} />
      <div className="fixed left-1/2 top-1/2 z-[100] w-[400px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-bg-elevated shadow-2xl">
        <div className="border-b border-border px-4 py-3">
          <span className="text-sm font-semibold text-fg">{title}</span>
        </div>
        <div className="px-4 py-4 text-sm text-fg-muted">
          {message}
          {children}
          {error && <p className="mt-2 whitespace-pre-wrap break-words text-danger/90">{error}</p>}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-fg-muted hover:bg-bg-inset"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={confirmDisabled}
            className="rounded-md bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-red-600"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
