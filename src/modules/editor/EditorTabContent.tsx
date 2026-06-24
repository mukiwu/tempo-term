import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Columns2, Eye, SquarePen, WrapText, type LucideIcon } from "lucide-react";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { EditorView as CMView } from "@codemirror/view";
import { Compartment } from "@codemirror/state";
import { editorSyntaxTheme } from "@/themes/editorTheme";
import { languageLabel, loadLanguageExtension } from "./lib/language";
import { inlineCompletion, type CompletionRequest } from "./lib/inlineCompletion";
import { useEditorStore } from "./store/editorStore";
import { aiChat } from "@/modules/ai/lib/aiBridge";
import { providerById } from "@/modules/ai/lib/providers";
import { useChatStore } from "@/modules/ai/store/chatStore";
import { buildCompletionMessages, cleanCompletion } from "@/modules/ai/lib/completion";
import { shouldReloadFromDisk } from "./lib/reload";
import { fsReadFile, fsWriteFile } from "@/modules/explorer/lib/fsBridge";
import { basename } from "@/modules/explorer/lib/paths";
import { MarkdownView } from "@/components/MarkdownView";
import { Tooltip } from "@/components/Tooltip";
import { selectTerminalFontFamily, useFontStore } from "@/stores/fontStore";
import { useSettingsStore } from "@/stores/settingsStore";

type EditorMode = "edit" | "split" | "preview";

const MODES: { key: EditorMode; icon: LucideIcon }[] = [
  { key: "edit", icon: SquarePen },
  { key: "split", icon: Columns2 },
  { key: "preview", icon: Eye },
];

function isMarkdownPath(path: string): boolean {
  return /\.(md|markdown|mdx)$/i.test(path);
}

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
export function EditorTabContent({ path }: { path: string }) {
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
    try {
      await fsWriteFile(path, current);
      markSaved(path);
    } catch {
      // a toast surface comes later
    }
  }

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
      {/* pr-8 leaves room for the pane's close button (absolute, top-right). */}
      <div className="flex h-7 shrink-0 items-center justify-between gap-2 border-b border-border pl-2 pr-8">
        <span className="min-w-0 truncate text-xs text-fg-muted" title={path}>
          {basename(path)}
        </span>
        <div className="flex shrink-0 items-center gap-0.5">
        <Tooltip label={t("wrap")}>
          <button
            type="button"
            aria-label={t("wrap")}
            aria-pressed={wordWrap}
            onClick={toggleWordWrap}
            className={`rounded p-1 ${
              wordWrap ? "bg-bg-elevated text-fg" : "text-fg-muted hover:bg-bg-elevated hover:text-fg"
            }`}
          >
            <WrapText size={14} />
          </button>
        </Tooltip>
        {isMarkdown &&
          MODES.map((m) => {
            const Icon = m.icon;
            const active = mode === m.key;
            return (
              <Tooltip key={m.key} label={t(`mode.${m.key}`)}>
                <button
                  type="button"
                  aria-label={t(`mode.${m.key}`)}
                  aria-pressed={active}
                  onClick={() => setMode(m.key)}
                  className={`rounded p-1 ${
                    active ? "bg-bg-elevated text-fg" : "text-fg-muted hover:bg-bg-elevated hover:text-fg"
                  }`}
                >
                  <Icon size={14} />
                </button>
              </Tooltip>
            );
          })}
        </div>
      </div>

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
    </div>
  );
}
