import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { FileCode, X } from "lucide-react";
import CodeMirror from "@uiw/react-codemirror";
import { EditorView as CMView } from "@codemirror/view";
import { oneDark } from "@codemirror/theme-one-dark";
import { languageExtension } from "./lib/language";
import { useEditorStore } from "./store/editorStore";
import { fsReadFile, fsWriteFile } from "@/modules/explorer/lib/fsBridge";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { selectTerminalFontFamily, useFontStore } from "@/stores/fontStore";

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function EmptyState() {
  const { t } = useTranslation("editor");
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-fg-subtle">
      <FileCode size={48} strokeWidth={1} />
      <p className="text-sm font-medium text-fg-muted">{t("emptyTitle")}</p>
      <p className="text-xs">{t("emptyHint")}</p>
    </div>
  );
}

export function EditorView() {
  const { t } = useTranslation("editor");
  const openFiles = useWorkspaceStore((s) => s.openFiles);
  const activeFile = useWorkspaceStore((s) => s.activeFile);
  const setActiveFile = useWorkspaceStore((s) => s.setActiveFile);
  const closeFile = useWorkspaceStore((s) => s.closeFile);

  const setBaseline = useEditorStore((s) => s.setBaseline);
  const setContent = useEditorStore((s) => s.setContent);
  const markSaved = useEditorStore((s) => s.markSaved);
  const buffers = useEditorStore((s) => s.buffers);

  const fontFamily = useFontStore(selectTerminalFontFamily);
  const fontSize = useFontStore((s) => s.fontSize);

  // Load file contents the first time a file becomes active.
  useEffect(() => {
    if (!activeFile || buffers[activeFile]) {
      return;
    }
    fsReadFile(activeFile)
      .then((content) => setBaseline(activeFile, content))
      .catch(() => setBaseline(activeFile, ""));
  }, [activeFile, buffers, setBaseline]);

  const themeExtension = useMemo(
    () =>
      CMView.theme({
        "&": { height: "100%", fontSize: `${fontSize}px` },
        ".cm-content, .cm-gutters": { fontFamily },
        ".cm-scroller": { fontFamily },
      }),
    [fontFamily, fontSize],
  );

  const extensions = useMemo(
    () => (activeFile ? [themeExtension, ...languageExtension(activeFile)] : [themeExtension]),
    [activeFile, themeExtension],
  );

  async function save() {
    if (!activeFile) {
      return;
    }
    const content = useEditorStore.getState().contentOf(activeFile);
    try {
      await fsWriteFile(activeFile, content);
      markSaved(activeFile);
    } catch {
      // surface errors via a toast in a later phase
    }
  }

  return (
    <div
      className="flex h-full flex-col bg-bg"
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
          e.preventDefault();
          void save();
        }
      }}
    >
      {openFiles.length > 0 && (
        <div className="flex h-9 shrink-0 items-center gap-1 overflow-x-auto border-b border-border bg-bg-inset px-2">
          {openFiles.map((path) => {
            const active = path === activeFile;
            const dirty = buffers[path]
              ? buffers[path].content !== buffers[path].baseline
              : false;
            return (
              <div
                key={path}
                role="tab"
                aria-selected={active}
                onClick={() => setActiveFile(path)}
                title={path}
                className={`group flex h-7 cursor-pointer items-center gap-2 rounded-md px-3 text-xs transition-colors ${
                  active
                    ? "bg-bg-elevated text-fg"
                    : "text-fg-muted hover:bg-bg-elevated/60"
                }`}
              >
                <span className="whitespace-nowrap">{basename(path)}</span>
                {dirty && (
                  <span
                    className="h-1.5 w-1.5 rounded-full bg-accent"
                    title={t("unsaved")}
                  />
                )}
                <button
                  type="button"
                  aria-label={t("save")}
                  onClick={(e) => {
                    e.stopPropagation();
                    closeFile(path);
                  }}
                  className="rounded p-0.5 text-fg-subtle opacity-0 hover:bg-border-strong hover:text-fg group-hover:opacity-100"
                >
                  <X size={12} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-hidden">
        {activeFile ? (
          <CodeMirror
            value={buffers[activeFile]?.content ?? ""}
            theme={oneDark}
            extensions={extensions}
            onChange={(value) => setContent(activeFile, value)}
            height="100%"
            style={{ height: "100%" }}
          />
        ) : (
          <EmptyState />
        )}
      </div>
    </div>
  );
}
