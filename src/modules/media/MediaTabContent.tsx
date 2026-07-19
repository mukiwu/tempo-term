import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { convertFileSrc } from "@tauri-apps/api/core";
import { PaneHeader } from "@/components/PaneHeader";

/**
 * In-app viewer for a local image file, rendered in the main webview through
 * the asset protocol (`convertFileSrc` emits the platform-correct URL). The
 * existing asset-scope deny-list applies, so a blocked or unreadable file
 * surfaces as the load-error message rather than a blank pane.
 */
export function MediaTabContent({
  path,
  showClose = false,
  onClose,
}: {
  path: string;
  showClose?: boolean;
  onClose?: () => void;
}) {
  const { t } = useTranslation("preview");
  const [failed, setFailed] = useState(false);
  const name = path.split(/[\\/]/).pop() ?? path;

  // A pane can be retargeted to another image; the error state is per file.
  useEffect(() => {
    setFailed(false);
  }, [path]);

  return (
    <div className="flex h-full flex-col bg-bg">
      <PaneHeader
        left={<span className="min-w-0 truncate text-xs text-fg-muted">{name}</span>}
        showClose={showClose}
        onClose={() => onClose?.()}
      />
      {failed ? (
        <p className="px-3 py-2 text-xs text-danger">{t("mediaLoadError")}</p>
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4">
          <img
            src={convertFileSrc(path)}
            alt={name}
            onError={() => setFailed(true)}
            className="max-h-full max-w-full object-contain"
          />
        </div>
      )}
    </div>
  );
}
