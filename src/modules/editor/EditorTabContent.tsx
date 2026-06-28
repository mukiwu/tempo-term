import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { EditorView as CMView } from "@codemirror/view";
import { Compartment } from "@codemirror/state";
import { editorSyntaxTheme } from "@/themes/editorTheme";
import { isMarkdownPath, languageLabel, loadLanguageExtension } from "./lib/language";
import { inlineCompletion, type CompletionRequest } from "./lib/inlineCompletion";
import { useEditorStore } from "./store/editorStore";
import { aiChat } from "@/modules/ai/lib/aiBridge";
import { providerById } from "@/modules/ai/lib/providers";
import { useChatStore } from "@/modules/ai/store/chatStore";
import { buildCompletionMessages, cleanCompletion } from "@/modules/ai/lib/completion";
import { externalChangeAction, manualReloadAction, shouldReloadFromDisk } from "./lib/reload";
import { onEditorFileChanged } from "./lib/editorWatch";
import { fsReadFile, fsWriteFile } from "@/modules/explorer/lib/fsBridge";
import { MarkdownView } from "@/components/MarkdownView";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EditorToolbar, type EditorMode } from "./EditorToolbar";
import { selectTerminalFontFamily, useFontStore } from "@/stores/fontStore";
import { useSettingsStore } from "@/stores/settingsStore";

// After we save, the watcher reports our own write back as a change. Ignore
// those echoes for a short window so a save never bounces back as a reload.
const SELF_WRITE_WINDOW_MS = 2000;

/** Ask the active chat provider to complete the code around the cursor. */
async function requestCompletion(
  prefix: string,
  suffix: string,
  language: string,
): Promise<string> {
  const { providerId, model } = useChatStore.getState();
  const provider = providerById(providerId);
  const reply = await aiChat({
    provider: provider.id,
    kind: provider.kind,
    baseUrl: provider.baseUrl,
    model,
    messages: buildCompletionMessages(prefix, suffix, language),
  });
  return cleanCompletion(reply, prefix);
}

/** One open file. Each editor tab renders a single file with its own buffer. */
export function EditorTabContent({
  path,
  onOpenWebPreview,
}: {
  path: string;
  onOpenWebPreview?: () => void;
}) {
  const { t } = useTranslation("editor");
  const setBaseline = useEditorStore((s) => s.setBaseline);
  const setContent = useEditorStore((s) => s.setContent);
  const markSaved = useEditorStore((s) => s.markSaved);
  const content = useEditorStore((s) => s.buffers[path]?.content ?? "");

  const fontFamily = useFontStore(selectTerminalFontFamily);
  const fontSize = useFontStore((s) => s.fontSize);
  const themeId = useSettingsStore((s) => s.themeId);
  const wordWrap = useSettingsStore((s) => s.wordWrap);
  const toggleWordWrap = useSettingsStore((s) => s.toggleWordWrap);
  const aiInlineCompletionEnabled = useSettingsStore((s) => s.aiInlineCompletion);

  const isMarkdown = isMarkdownPath(path);
  const [mode, setMode] = useState<EditorMode>("edit");
  const [confirmReload, setConfirmReload] = useState(false);
  const [externalChanged, setExternalChanged] = useState(false);
  const selfWrite = useRef<{ path: string; at: number } | null>(null);
  const effectiveMode: EditorMode = isMarkdown ? mode : "edit";

  const cmRef = useRef<ReactCodeMirrorRef>(null);
  // The language grammar lives in its own compartment so we can swap it in
  // after the async load resolves without rebuilding the whole editor config.
  const languageCompartment = useRef(new Compartment());

  useEffect(() => {
    // Re-read from disk whenever the file (re)opens so external edits show up;
    // skip only when there are unsaved local edits, to avoid clobbering them.
    if (!shouldReloadFromDisk(useEditorStore.getState().buffers[path])) {
      return;
    }
    fsReadFile(path)
      .then((text) => setBaseline(path, text))
      .catch(() => setBaseline(path, ""));
  }, [path, setBaseline]);

  const extensions = useMemo(() => {
    const base = [
      CMView.theme({
        "&": { height: "100%", fontSize: `${fontSize}px` },
        ".cm-content, .cm-gutters, .cm-scroller": { fontFamily },
      }),
      ...(wordWrap ? [CMView.lineWrapping] : []),
      languageCompartment.current.of([]),
    ];
    if (aiInlineCompletionEnabled) {
      const language = languageLabel(path);
      const request: CompletionRequest = (prefix, suffix) =>
        requestCompletion(prefix, suffix, language);
      base.push(inlineCompletion(request));
    }
    return base;
  }, [path, fontFamily, fontSize, wordWrap, aiInlineCompletionEnabled]);

  // Load the grammar for the current file (language-data fetches each on
  // demand) and swap it into the editor once ready. A stale load for a file we
  // already navigated away from is dropped.
  useEffect(() => {
    let cancelled = false;
    // Clear immediately so the new file doesn't flash with the previous
    // file's grammar while the async load is in flight.
    const view = cmRef.current?.view;
    if (view) {
      view.dispatch({ effects: languageCompartment.current.reconfigure([]) });
    }
    void loadLanguageExtension(path).then((extension) => {
      const currentView = cmRef.current?.view;
      if (cancelled || !currentView) {
        return;
      }
      currentView.dispatch({ effects: languageCompartment.current.reconfigure(extension) });
    });
    return () => {
      cancelled = true;
    };
    // effectiveMode is a dep because toggling markdown preview remounts the
    // editor with a fresh view, which would otherwise lose its highlighting.
  }, [path, effectiveMode]);

  async function save() {
    const current = useEditorStore.getState().contentOf(path);
    // Mark our own write BEFORE the async write: the OS watcher event can arrive
    // before fsWriteFile resolves, so setting the marker afterwards would race and
    // let our own save be mistaken for an external change.
    selfWrite.current = { path, at: Date.now() };
    try {
      await fsWriteFile(path, current);
      markSaved(path);
    } catch {
      selfWrite.current = null;
      // a toast surface comes later
    }
  }

  // Re-read the file from disk into the buffer (content + baseline → clean), so
  // external edits (e.g. an AI agent editing the file) show up without closing
  // and reopening the tab.
  function reloadFromDisk() {
    fsReadFile(path)
      .then((text) => {
        setBaseline(path, text);
        setExternalChanged(false);
      })
      .catch(() => {});
  }

  // The refresh button: reload immediately when there is nothing to lose, but
  // confirm first when the buffer has unsaved edits.
  function handleRefresh() {
    if (manualReloadAction(useEditorStore.getState().buffers[path]) === "confirm") {
      setConfirmReload(true);
    } else {
      reloadFromDisk();
    }
  }

  const keepMine = () => setExternalChanged(false);

  // A path switch on the same component instance starts fresh: drop any pending
  // conflict flag and the stale self-write marker.
  useEffect(() => {
    setExternalChanged(false);
    selfWrite.current = null;
  }, [path]);

  // React to the watcher reporting this file changed on disk (e.g. an AI agent
  // edited it). Ignore the echo of our own save; reload a clean buffer silently;
  // raise the conflict banner when there are unsaved edits so they are kept.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void onEditorFileChanged((changedPath) => {
      if (changedPath !== path) {
        return;
      }
      const sw = selfWrite.current;
      const isSelfSave = sw?.path === path && Date.now() - sw.at < SELF_WRITE_WINDOW_MS;
      const action = externalChangeAction(useEditorStore.getState().buffers[path], isSelfSave);
      if (action === "reload") {
        reloadFromDisk();
      } else if (action === "flag") {
        setExternalChanged(true);
      }
    }).then((fn) => {
      if (disposed) {
        fn();
      } else {
        unlisten = fn;
      }
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
    // reloadFromDisk closes over `path` and stable setters; re-subscribe on path.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  const editorPane = (
    <CodeMirror
      ref={cmRef}
      value={content}
      theme={editorSyntaxTheme(themeId)}
      extensions={extensions}
      onChange={(value) => setContent(path, value)}
      height="100%"
      style={{ height: "100%" }}
    />
  );

  const previewPane = (
    <MarkdownView content={content} className="h-full overflow-y-auto px-6 py-4" />
  );

  return (
    <div
      className="flex h-full w-full flex-col overflow-hidden bg-bg"
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
          e.preventDefault();
          void save();
        }
      }}
    >
      <EditorToolbar
        path={path}
        wordWrap={wordWrap}
        onToggleWordWrap={toggleWordWrap}
        onRefresh={handleRefresh}
        onOpenWebPreview={onOpenWebPreview}
        mode={mode}
        onSetMode={setMode}
      />

      {externalChanged && (
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-warning/10 px-3 py-1.5 text-xs text-fg">
          <span>{t("externalChanged")}</span>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={reloadFromDisk}
              className="rounded border border-border-strong px-2 py-0.5 hover:bg-border-strong"
            >
              {t("useDiskVersion")}
            </button>
            <button
              type="button"
              onClick={keepMine}
              className="rounded border border-border-strong px-2 py-0.5 hover:bg-border-strong"
            >
              {t("keepMine")}
            </button>
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-hidden">
        {effectiveMode === "split" ? (
          <div className="flex h-full">
            <div className="h-full w-1/2 min-w-0 overflow-hidden border-r border-border">
              {editorPane}
            </div>
            <div className="h-full w-1/2 min-w-0">{previewPane}</div>
          </div>
        ) : effectiveMode === "preview" ? (
          previewPane
        ) : (
          editorPane
        )}
      </div>

      {confirmReload && (
        <ConfirmDialog
          title={t("reloadUnsavedTitle")}
          message={t("reloadUnsavedMessage")}
          confirmLabel={t("discardReload")}
          cancelLabel={t("common:actions.cancel")}
          onConfirm={() => {
            setConfirmReload(false);
            reloadFromDisk();
          }}
          onCancel={() => setConfirmReload(false)}
        />
      )}
    </div>
  );
}
