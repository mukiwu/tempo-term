import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { RotateCw } from "lucide-react";
import { onEditorFileChanged } from "@/modules/editor/lib/editorWatch";
import { normalizeAddressInput } from "@/lib/url";
import { previewLocalPath } from "./lib/htmlPreviewTarget";
import { useNativePreviewWebview } from "./hooks/useNativePreviewWebview";

interface PreviewTabContentProps {
  url: string;
  /** The owning pane's leaf id; part of the native webview's unique label. */
  leafId: string;
  /**
   * Whether the native preview webview should be shown. It floats above all DOM,
   * so the parent hides it whenever the pane is not the foremost thing on screen
   * (inactive tab/space, split drag, or an open overlay).
   */
  visible: boolean;
  /**
   * Called when the user navigates via the address bar, so the owning pane can
   * persist the new url and retitle the tab. Local-file previews don't supply it.
   */
  onNavigate?: (url: string) => void;
}

export function PreviewTabContent({ url, leafId, visible, onNavigate }: PreviewTabContentProps) {
  const { t } = useTranslation("preview");
  const [current, setCurrent] = useState(url);
  const [input, setInput] = useState(url);
  const { hostRef, reload } = useNativePreviewWebview({ url: current, leafId, visible });

  // Follow the url prop when it changes (e.g. a file dropped onto this pane).
  useEffect(() => {
    setCurrent(url);
    setInput(url);
  }, [url]);

  // Local-file previews auto-reload when the file changes on disk (e.g. you save
  // it in the editor). Web urls are not watched. The watched SET is maintained
  // by installEditorWatchSync (it includes local preview paths); here we only
  // listen and reload the native webview when our own file is the one changed.
  useEffect(() => {
    const localPath = previewLocalPath(current);
    if (!localPath) {
      return;
    }
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void onEditorFileChanged((changedPath) => {
      if (changedPath === localPath) {
        reload();
      }
    })
      .then((fn) => {
        if (disposed) {
          fn();
        } else {
          unlisten = fn;
        }
      })
      .catch(() => {});
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [current, reload]);

  return (
    <div className="flex h-full flex-col bg-bg">
      <form
        className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-2"
        onSubmit={(e) => {
          e.preventDefault();
          const next = normalizeAddressInput(input);
          setCurrent(next);
          setInput(next);
          onNavigate?.(next);
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t("urlPlaceholder")}
          aria-label={t("urlPlaceholder")}
          className="min-w-0 flex-1 rounded-md border border-border bg-bg-inset px-3 py-1 text-xs text-fg outline-none focus:border-accent"
        />
        <button
          type="button"
          aria-label={t("reload")}
          title={t("reload")}
          onClick={reload}
          className="rounded p-1 text-fg-muted hover:bg-bg-elevated hover:text-fg"
        >
          <RotateCw size={14} />
        </button>
      </form>
      {/* The native preview webview is composited over this host element; it is
          positioned to match the host's rect. bg-white shows while the webview
          loads or when it is hidden. */}
      <div ref={hostRef} className="min-h-0 flex-1 bg-white" />
    </div>
  );
}
