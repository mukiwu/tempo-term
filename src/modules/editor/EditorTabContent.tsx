import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Columns2, Eye, SquarePen, type LucideIcon } from "lucide-react";
import CodeMirror from "@uiw/react-codemirror";
import { EditorView as CMView } from "@codemirror/view";
import { oneDark } from "@codemirror/theme-one-dark";
import { languageExtension } from "./lib/language";
import { useEditorStore } from "./store/editorStore";
import { fsReadFile, fsWriteFile } from "@/modules/explorer/lib/fsBridge";
import { MarkdownView } from "@/components/MarkdownView";
import { selectTerminalFontFamily, useFontStore } from "@/stores/fontStore";

type EditorMode = "edit" | "split" | "preview";

const MODES: { key: EditorMode; icon: LucideIcon }[] = [
  { key: "edit", icon: SquarePen },
  { key: "split", icon: Columns2 },
  { key: "preview", icon: Eye },
];

function isMarkdownPath(path: string): boolean {
  return /\.(md|markdown|mdx)$/i.test(path);
}

/** One open file. Each editor tab renders a single file with its own buffer. */
export function EditorTabContent({ path }: { path: string }) {
  const { t } = useTranslation("editor");
  const setBaseline = useEditorStore((s) => s.setBaseline);
  const setContent = useEditorStore((s) => s.setContent);
  const markSaved = useEditorStore((s) => s.markSaved);
  const content = useEditorStore((s) => s.buffers[path]?.content ?? "");
  const loaded = useEditorStore((s) => s.buffers[path] !== undefined);

  const fontFamily = useFontStore(selectTerminalFontFamily);
  const fontSize = useFontStore((s) => s.fontSize);

  const isMarkdown = isMarkdownPath(path);
  const [mode, setMode] = useState<EditorMode>("edit");
  const effectiveMode: EditorMode = isMarkdown ? mode : "edit";

  useEffect(() => {
    if (loaded) {
      return;
    }
    fsReadFile(path)
      .then((text) => setBaseline(path, text))
      .catch(() => setBaseline(path, ""));
  }, [path, loaded, setBaseline]);

  const extensions = useMemo(
    () => [
      CMView.theme({
        "&": { height: "100%", fontSize: `${fontSize}px` },
        ".cm-content, .cm-gutters, .cm-scroller": { fontFamily },
      }),
      ...languageExtension(path),
    ],
    [path, fontFamily, fontSize],
  );

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
      value={content}
      theme={oneDark}
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
      {isMarkdown && (
        <div className="flex h-7 shrink-0 items-center justify-end gap-0.5 border-b border-border px-2">
          {MODES.map((m) => {
            const Icon = m.icon;
            const active = mode === m.key;
            return (
              <button
                key={m.key}
                type="button"
                title={t(`mode.${m.key}`)}
                aria-label={t(`mode.${m.key}`)}
                aria-pressed={active}
                onClick={() => setMode(m.key)}
                className={`rounded p-1 ${
                  active ? "bg-bg-elevated text-fg" : "text-fg-muted hover:bg-bg-elevated hover:text-fg"
                }`}
              >
                <Icon size={14} />
              </button>
            );
          })}
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
    </div>
  );
}
