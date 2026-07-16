import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp, WrapText } from "lucide-react";
import { getChunks, MergeView, type Chunk } from "@codemirror/merge";
import { EditorState } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { PaneHeader } from "@/components/PaneHeader";
import { Tooltip } from "@/components/Tooltip";
import { gitFileAtRev, gitResolveRepo } from "@/modules/source-control/lib/gitBridge";
import { fsReadFile } from "@/modules/explorer/lib/fsBridge";
import { loadLanguageExtension } from "@/modules/editor/lib/language";
import { dirname, relativePath } from "@/modules/explorer/lib/paths";
import { editorSyntaxTheme } from "@/themes/editorTheme";
import { selectTerminalFontFamily, useFontStore } from "@/stores/fontStore";
import { useSettingsStore } from "@/stores/settingsStore";

interface DiffTabContentProps {
  /** Absolute path of the file being compared. */
  path: string;
  /** true = HEAD vs index (staged tab); false = index vs working tree. */
  staged: boolean;
  /** Show the shared pane close button (the tab is split). */
  showClose?: boolean;
  onClose?: () => void;
}

interface DiffDocs {
  left: string;
  right: string;
}

/**
 * Read-only side-by-side comparison of one file's uncommitted changes.
 * Unstaged tab: index (left) vs working tree (right). Staged tab: HEAD (left)
 * vs index (right). MergeView computes the highlighting from the two full
 * documents; contents reload when the window regains focus so the tab stays
 * roughly current without a file watcher.
 */
export function DiffTabContent({ path, staged, showClose = false, onClose }: DiffTabContentProps) {
  const { t } = useTranslation("sourceControl");
  const { t: tEditor } = useTranslation("editor");
  const containerRef = useRef<HTMLDivElement>(null);
  const mergeViewRef = useRef<MergeView | null>(null);
  const fontFamily = useFontStore(selectTerminalFontFamily);
  const themeId = useSettingsStore((s) => s.themeId);
  // Shares the editor's word-wrap setting so both surfaces toggle together.
  const wordWrap = useSettingsStore((s) => s.wordWrap);
  const toggleWordWrap = useSettingsStore((s) => s.toggleWordWrap);
  const [docs, setDocs] = useState<DiffDocs | null>(null);
  const [error, setError] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  // 1-based position of the chunk the cursor sits in (0 = before the first).
  const [chunkPos, setChunkPos] = useState({ current: 0, total: 0 });

  // Re-read both sides when the window regains focus (e.g. after staging or
  // editing elsewhere); cheap enough that no file watcher is needed.
  useEffect(() => {
    const bump = () => setRefreshKey((k) => k + 1);
    window.addEventListener("focus", bump);
    return () => window.removeEventListener("focus", bump);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const repo = await gitResolveRepo(dirname(path));
        if (!repo) {
          throw new Error("not a git repository");
        }
        const rel = relativePath(path, repo);
        const [left, right] = await Promise.all(
          staged
            ? [gitFileAtRev(repo, "HEAD", rel), gitFileAtRev(repo, ":", rel)]
            : [gitFileAtRev(repo, ":", rel), fsReadFile(path).catch(() => "")],
        );
        if (!cancelled) {
          setError(false);
          // Keep the previous object when nothing changed so the MergeView
          // effect doesn't tear down and lose scroll position on refocus.
          setDocs((prev) =>
            prev && prev.left === left && prev.right === right ? prev : { left, right },
          );
        }
      } catch {
        if (!cancelled) {
          setError(true);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [path, staged, refreshKey]);

  useEffect(() => {
    const parent = containerRef.current;
    if (!docs || !parent) {
      return;
    }
    let view: MergeView | null = null;
    let cancelled = false;
    // A failed grammar load falls back to plain text instead of leaving the
    // tab stuck without a MergeView.
    void loadLanguageExtension(path)
      .catch(() => [])
      .then((language) => {
      if (cancelled) {
        return;
      }
      const extensions = [
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        // Localizes the collapsed-region bar ("$ unchanged lines").
        EditorState.phrases.of({ "$ unchanged lines": t("diffUnchangedLines") }),
        editorSyntaxTheme(themeId),
        // Fixed 13px to match the Git Graph diff view's type size. Height and
        // scrolling belong to the outer .cm-mergeView container (the merge
        // package forces the editors themselves to auto height).
        EditorView.theme({
          "&": { fontSize: "13px" },
          ".cm-content, .cm-gutters, .cm-scroller": { fontFamily },
        }),
        lineNumbers(),
        ...(wordWrap ? [EditorView.lineWrapping] : []),
        ...language,
      ];
      view = new MergeView({
        a: { doc: docs.left, extensions },
        b: { doc: docs.right, extensions },
        parent,
        gutter: true,
        // Collapse long unchanged stretches into an expandable bar (VS Code
        // style), so a large file reads as just its changes.
        collapseUnchanged: { margin: 3, minSize: 5 },
      });
      mergeViewRef.current = view;
      // Land on the first change right away so the counter starts at 1/N and
      // the change is pinned in view.
      const chunks = getChunks(view.b.state)?.chunks ?? [];
      setChunkPos({ current: chunks.length > 0 ? 1 : 0, total: chunks.length });
      if (chunks.length > 0) {
        scrollToChunk(view, chunks[0]);
      }
    });
    return () => {
      cancelled = true;
      mergeViewRef.current = null;
      view?.destroy();
    };
  }, [docs, path, themeId, fontFamily, wordWrap]);

  // Pin a chunk's first line to the top of the real scroll container (the
  // outer .cm-mergeView). lineBlockAt gives document geometry without needing
  // the line to be rendered, so this works across collapsed regions too.
  function scrollToChunk(view: MergeView, chunk: Chunk) {
    const pos = Math.min(chunk.fromB, view.b.state.doc.length);
    const top = view.b.lineBlockAt(pos).top;
    const scroller = containerRef.current?.querySelector(".cm-mergeView");
    if (scroller) {
      scroller.scrollTop = Math.max(0, top - 8);
    }
  }

  // Step the current/total counter and bring that chunk into view. Navigation
  // is index-based (not selection-based): a read-only diff has no visible
  // cursor, and with collapsed regions everything may already fit on screen.
  function goToChunk(direction: "prev" | "next") {
    const view = mergeViewRef.current;
    if (!view) {
      return;
    }
    const chunks = getChunks(view.b.state)?.chunks ?? [];
    if (chunks.length === 0) {
      return;
    }
    const next =
      direction === "next"
        ? Math.min(chunkPos.current + 1, chunks.length)
        : Math.max(chunkPos.current - 1, 1);
    scrollToChunk(view, chunks[next - 1]);
    setChunkPos({ current: next, total: chunks.length });
  }

  const name = path.split(/[\\/]/).pop() ?? path;

  return (
    <div className="flex h-full flex-col bg-bg">
      <PaneHeader
        left={
        /* The controls sit at the end of the left half — the visual middle of
            the two panes — where they are easy to spot. */
        <div className="flex w-1/2 items-center gap-2">
        <span className="min-w-0 truncate text-xs text-fg-muted">{name}</span>
        <span className="shrink-0 rounded bg-bg-elevated px-1.5 py-0.5 text-[10px] font-medium uppercase text-fg-subtle">
          {staged ? t("diffStaged") : t("diffUnstaged")}
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          {chunkPos.total > 0 && (
            <span className="mr-1 font-mono text-[11px] text-fg-subtle">
              {chunkPos.current}/{chunkPos.total}
            </span>
          )}
          <Tooltip label={t("diffPrevChange")}>
            <button
              type="button"
              aria-label={t("diffPrevChange")}
              onClick={() => goToChunk("prev")}
              className="rounded p-1 text-fg-muted hover:bg-bg-elevated hover:text-fg"
            >
              <ChevronUp size={14} />
            </button>
          </Tooltip>
          <Tooltip label={t("diffNextChange")}>
            <button
              type="button"
              aria-label={t("diffNextChange")}
              onClick={() => goToChunk("next")}
              className="rounded p-1 text-fg-muted hover:bg-bg-elevated hover:text-fg"
            >
              <ChevronDown size={14} />
            </button>
          </Tooltip>
          <Tooltip label={tEditor("wrap")}>
            <button
              type="button"
              aria-label={tEditor("wrap")}
              aria-pressed={wordWrap}
              onClick={toggleWordWrap}
              className={`rounded p-1 ${
                wordWrap
                  ? "bg-bg-elevated text-fg"
                  : "text-fg-muted hover:bg-bg-elevated hover:text-fg"
              }`}
            >
              <WrapText size={14} />
            </button>
          </Tooltip>
        </div>
        </div>
        }
        showClose={showClose}
        onClose={() => onClose?.()}
      />
      {error ? (
        <p className="px-3 py-2 text-xs text-danger">{t("diffLoadError")}</p>
      ) : (
        <div ref={containerRef} className="diff-merge-view min-h-0 flex-1 overflow-hidden" />
      )}
    </div>
  );
}
