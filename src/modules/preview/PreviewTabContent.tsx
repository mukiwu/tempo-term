import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { RotateCw } from "lucide-react";
import { onEditorFileChanged } from "@/modules/editor/lib/editorWatch";
import { resolvePreviewSrc } from "./lib/resolvePreviewSrc";
import { previewLocalPath } from "./lib/htmlPreviewTarget";

export function PreviewTabContent({ url }: { url: string }) {
  const { t } = useTranslation("preview");
  const [current, setCurrent] = useState(url);
  const [input, setInput] = useState(url);
  const [reloadKey, setReloadKey] = useState(0);
  const frameRef = useRef<HTMLIFrameElement>(null);

  // Follow the url prop when it changes (e.g. a file dropped onto this pane).
  useEffect(() => {
    setCurrent(url);
    setInput(url);
  }, [url]);

  // Local-file previews auto-reload when the file changes on disk (e.g. you save
  // it in the editor). Web urls are not watched. The watched SET is maintained
  // by installEditorWatchSync (it includes local preview paths); here we only
  // listen and reload when our own file is the one that changed.
  useEffect(() => {
    const localPath = previewLocalPath(current);
    if (!localPath) {
      return;
    }
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void onEditorFileChanged((changedPath) => {
      if (changedPath === localPath) {
        setReloadKey((k) => k + 1);
      }
    }).then((fn) => {
      if (disposed) {
        fn();
      } else {
        unlisten = fn;
      }
    }).catch(() => {});
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [current]);

  return (
    <div className="flex h-full flex-col bg-bg">
      <form
        className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-2"
        onSubmit={(e) => {
          e.preventDefault();
          setCurrent(input.trim());
          setReloadKey((k) => k + 1);
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
          onClick={() => setReloadKey((k) => k + 1)}
          className="rounded p-1 text-fg-muted hover:bg-bg-elevated hover:text-fg"
        >
          <RotateCw size={14} />
        </button>
      </form>
      <iframe
        ref={frameRef}
        key={reloadKey}
        data-reload={reloadKey}
        src={resolvePreviewSrc(current)}
        title={t("title")}
        className="min-h-0 flex-1 w-full border-0 bg-white"
      />
    </div>
  );
}
