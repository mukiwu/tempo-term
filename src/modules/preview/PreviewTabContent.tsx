import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, ArrowRight, RotateCw } from "lucide-react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { Tooltip } from "@/components/Tooltip";
import { onEditorFileChanged } from "@/modules/editor/lib/editorWatch";
import { normalizeAddressInput } from "@/lib/url";
import { previewLocalPath } from "./lib/htmlPreviewTarget";
import { registerPreviewControls } from "./lib/previewControls";
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
   * Called when the page navigates (address bar, link click, or redirect), so
   * the owning pane can persist the new url and retitle the tab. Local-file
   * previews don't supply it.
   */
  onNavigate?: (url: string) => void;
  /** Called when the page's `<title>` changes, so the owning tab can retitle. */
  onTitle?: (title: string) => void;
}

export function PreviewTabContent({
  url,
  leafId,
  visible,
  onNavigate,
  onTitle,
}: PreviewTabContentProps) {
  const { t } = useTranslation("preview");
  const [input, setInput] = useState(url);
  const inputRef = useRef<HTMLInputElement>(null);
  const { hostRef, reload, back, forward } = useNativePreviewWebview({
    url,
    leafId,
    visible,
    onNavigate,
    onTitle,
  });

  // Follow the url prop when it changes (a file dropped onto this pane, or a
  // navigation persisted from within the page).
  useEffect(() => {
    setInput(url);
  }, [url]);

  const focusAddressBar = useCallback(() => {
    // The native preview webview holds key focus; pull it back to the app webview
    // before selecting the input so the user can type immediately.
    void getCurrentWebview().setFocus().catch(() => {});
    const el = inputRef.current;
    if (el) {
      el.focus();
      el.select();
    }
  }, []);

  // Expose this preview's controls so the ⌘/Ctrl+L keydown handler and ⌘[ / ⌘]
  // shortcuts can reach whichever preview pane is active.
  useEffect(
    () => registerPreviewControls(leafId, { focusAddressBar, back, forward, reload }),
    [leafId, focusAddressBar, back, forward, reload],
  );

  // Local-file previews auto-reload when the file changes on disk (e.g. you save
  // it in the editor). Web urls are not watched. The watched SET is maintained
  // by installEditorWatchSync (it includes local preview paths); here we only
  // listen and reload the native webview when our own file is the one changed.
  useEffect(() => {
    const localPath = previewLocalPath(url);
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
  }, [url, reload]);

  return (
    <div className="flex h-full flex-col bg-bg">
      <form
        className="flex h-9 shrink-0 items-center gap-1 border-b border-border px-2"
        onSubmit={(e) => {
          e.preventDefault();
          const next = normalizeAddressInput(input);
          setInput(next);
          onNavigate?.(next);
        }}
      >
        <Tooltip label={t("back")}>
          <button
            type="button"
            aria-label={t("back")}
            onClick={back}
            className="rounded p-1 text-fg-muted hover:bg-bg-elevated hover:text-fg"
          >
            <ArrowLeft size={14} />
          </button>
        </Tooltip>
        <Tooltip label={t("forward")}>
          <button
            type="button"
            aria-label={t("forward")}
            onClick={forward}
            className="rounded p-1 text-fg-muted hover:bg-bg-elevated hover:text-fg"
          >
            <ArrowRight size={14} />
          </button>
        </Tooltip>
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t("urlPlaceholder")}
          aria-label={t("urlPlaceholder")}
          className="min-w-0 flex-1 rounded-md border border-border bg-bg-inset px-3 py-1 text-xs text-fg outline-none focus:border-accent"
        />
        <Tooltip label={t("reload")}>
          <button
            type="button"
            aria-label={t("reload")}
            onClick={reload}
            className="rounded p-1 text-fg-muted hover:bg-bg-elevated hover:text-fg"
          >
            <RotateCw size={14} />
          </button>
        </Tooltip>
      </form>
      {/* The native preview webview is composited over this host element; it is
          positioned to match the host's rect. bg-white shows while the webview
          loads or when it is hidden. */}
      <div ref={hostRef} className="min-h-0 flex-1 bg-white" />
    </div>
  );
}
