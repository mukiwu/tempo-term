import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Minus, Square, X } from "lucide-react";
import { IS_WINDOWS } from "@/lib/platform";
import {
  closeWindow,
  isWindowMaximized,
  minimizeWindow,
  onWindowResized,
  toggleMaximizeWindow,
} from "@/lib/window";

/** Overlapping-squares "restore" glyph; lucide has no direct equivalent. */
function RestoreIcon({ size = 11 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      aria-hidden="true"
    >
      <path d="M3 3H9V9H3V3Z" />
      <path d="M5 1.5H11V7.5H9" />
    </svg>
  );
}

/**
 * Custom title bar for Windows, where the native frame is hidden
 * (`decorations(false)`). A draggable region fills the left, and the
 * minimize / maximize-restore / close controls sit on the right — kept in a
 * separate, non-draggable element so clicks aren't swallowed by the drag
 * region. Renders nothing on macOS, which keeps its native overlay title bar.
 */
export function TitleBar() {
  const { t } = useTranslation();
  const [isMaximized, setIsMaximized] = useState(false);

  // Track the maximized state so the middle button shows the right icon/label.
  // Hooks run unconditionally; the effect no-ops off Windows.
  useEffect(() => {
    if (!IS_WINDOWS) {
      return;
    }
    const sync = () => {
      void isWindowMaximized()
        .then(setIsMaximized)
        .catch(() => {});
    };
    sync();
    const unlisten = onWindowResized(sync);
    return () => {
      void unlisten.then((off) => off()).catch(() => {});
    };
  }, []);

  if (!IS_WINDOWS) {
    return null;
  }

  return (
    <div className="flex h-8 shrink-0 items-center border-b border-border bg-bg-inset">
      <div data-tauri-drag-region className="h-full flex-1" />
      <div className="flex h-full shrink-0 items-center">
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
          aria-label={isMaximized ? t("titleBar.restore") : t("titleBar.maximize")}
          title={isMaximized ? t("titleBar.restore") : t("titleBar.maximize")}
          onClick={() => void toggleMaximizeWindow()}
          className="flex h-8 w-11 items-center justify-center text-fg-subtle transition-colors hover:bg-bg-elevated hover:text-fg"
        >
          {isMaximized ? <RestoreIcon size={11} /> : <Square size={12} />}
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
    </div>
  );
}
