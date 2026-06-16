import { useEffect, useMemo } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { EditorView as CMView } from "@codemirror/view";
import { oneDark } from "@codemirror/theme-one-dark";
import { languageExtension } from "./lib/language";
import { useEditorStore } from "./store/editorStore";
import { fsReadFile, fsWriteFile } from "@/modules/explorer/lib/fsBridge";
import { selectTerminalFontFamily, useFontStore } from "@/stores/fontStore";

/** One open file. Each editor tab renders a single file with its own buffer. */
export function EditorTabContent({ path }: { path: string }) {
  const setBaseline = useEditorStore((s) => s.setBaseline);
  const setContent = useEditorStore((s) => s.setContent);
  const markSaved = useEditorStore((s) => s.markSaved);
  const content = useEditorStore((s) => s.buffers[path]?.content ?? "");
  const loaded = useEditorStore((s) => s.buffers[path] !== undefined);

  const fontFamily = useFontStore(selectTerminalFontFamily);
  const fontSize = useFontStore((s) => s.fontSize);

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

  return (
    <div
      className="h-full w-full overflow-hidden bg-bg"
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
          e.preventDefault();
          void save();
        }
      }}
    >
      <CodeMirror
        value={content}
        theme={oneDark}
        extensions={extensions}
        onChange={(value) => setContent(path, value)}
        height="100%"
        style={{ height: "100%" }}
      />
    </div>
  );
}
