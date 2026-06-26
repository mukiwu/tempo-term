import { useTranslation } from "react-i18next";
import { Minus, Square, X } from "lucide-react";
import { IS_WINDOWS } from "@/lib/platform";
import { closeWindow, minimizeWindow, toggleMaximizeWindow } from "@/lib/window";

/**
 * Custom title bar for Windows, where the native frame is hidden
 * (`decorations(false)`). It provides the draggable region plus
 * minimize / maximize / close controls. Renders nothing on macOS, which keeps
 * its native overlay title bar.
 */
export function TitleBar() {
  const { t } = useTranslation();

  if (!IS_WINDOWS) {
    return null;
  }

  return (
    <div
      data-tauri-drag-region
      className="flex h-8 shrink-0 items-center justify-end border-b border-border bg-bg-inset"
    >
      <button
        type="button"
        aria-label={t("titleBar.minimize")}
        title={t("titleBar.minimize")}
        onClick={() => void minimizeWindow()}
        className="flex h-8 w-11 items-center justify-center text-fg-subtle transition-colors hover:bg-bg-elevated hover:text-fg"
      >
        <Minus size={15} />
      </button>
      <button
        type="button"
        aria-label={t("titleBar.maximize")}
        title={t("titleBar.maximize")}
        onClick={() => void toggleMaximizeWindow()}
        className="flex h-8 w-11 items-center justify-center text-fg-subtle transition-colors hover:bg-bg-elevated hover:text-fg"
      >
        <Square size={12} />
      </button>
      <button
        type="button"
        aria-label={t("titleBar.close")}
        title={t("titleBar.close")}
        onClick={() => void closeWindow()}
        className="flex h-8 w-11 items-center justify-center text-fg-subtle transition-colors hover:bg-danger hover:text-white"
      >
        <X size={16} />
      </button>
    </div>
  );
}
