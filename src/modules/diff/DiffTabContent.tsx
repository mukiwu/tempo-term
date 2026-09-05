import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  ChevronUp,
  Send,
  SquareSplitHorizontal,
  SquareSplitVertical,
  WrapText,
} from "lucide-react";
import { type Chunk } from "@codemirror/merge";
import { PaneHeader } from "@/components/PaneHeader";
import { Tooltip } from "@/components/Tooltip";
import { ContextMenu } from "@/components/ContextMenu";
import { gitFileAtRev, gitResolveRepo } from "@/modules/source-control/lib/gitBridge";
import { fsReadFile } from "@/modules/explorer/lib/fsBridge";
import { attachProxyScrollbars, type ProxyScrollbarsHandle } from "@/lib/proxyScrollbar";
import { linkHorizontalScroll } from "./lib/linkScroll";
import { dirname, relativePath } from "@/modules/explorer/lib/paths";
import { selectTerminalFontFamily, useFontStore } from "@/stores/fontStore";
import { useSettingsStore } from "@/stores/settingsStore";
import {
  buildDiffViews,
  collapseDiffRegion,
  destroyDiffViews,
  diffChunks,
  type DiffViews,
} from "./lib/diffViews";
import { agentTargetMenuItems } from "./lib/sendComments";
import { useDiffComments, useUnsentCommentCount } from "./lib/useDiffComments";

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
  const viewsRef = useRef<DiffViews | null>(null);
  const fontFamily = useFontStore(selectTerminalFontFamily);
  const fontSize = useFontStore((s) => s.fontSize);
  const themeId = useSettingsStore((s) => s.themeId);
  // Shares the editor's word-wrap setting so both surfaces toggle together.
  const wordWrap = useSettingsStore((s) => s.wordWrap);
  const toggleWordWrap = useSettingsStore((s) => s.toggleWordWrap);
  // Split vs inline is a reading preference, so it is remembered app-wide
  // rather than per tab.
  const unified = useSettingsStore((s) => s.diffUnified);
  const toggleUnified = useSettingsStore((s) => s.toggleDiffUnified);
  const hintSeen = useSettingsStore((s) => s.diffCommentHintSeen);
  const setHintSeen = useSettingsStore((s) => s.setDiffCommentHintSeen);
  const [docs, setDocs] = useState<DiffDocs | null>(null);
  const [error, setError] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  // 1-based position of the chunk the cursor sits in (0 = before the first).
  const [chunkPos, setChunkPos] = useState({ current: 0, total: 0 });
  // Review comments for the agent live in a store shared with every diff
  // surface; the unsent count across all files feeds the batch-send button.
  const unsent = useUnsentCommentCount();
  // Bumped once the async MergeView construction finishes, so the dispatch
  // effect below re-runs against the fresh editors.
  const [viewEpoch, setViewEpoch] = useState(0);
  const [sendMenu, setSendMenu] = useState<{ x: number; y: number } | null>(null);

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

  const foldLabels = {
    fold: t("diffCollapseUnchanged"),
    unfold: t("diffExpandUnchanged"),
  };

  const { commentHandlers, reanchorInto } = useDiffComments({
    path,
    staged,
    viewsRef,
    viewEpoch,
    labels: {
      add: t("diffCommentAdd"),
      placeholder: t("diffCommentPlaceholder"),
      save: t("diffCommentSave"),
      cancel: t("diffCommentCancel"),
      delete: t("diffCommentDelete"),
      sent: t("diffCommentSent"),
    },
  });

  useEffect(() => {
    const parent = containerRef.current;
    if (!docs || !parent) {
      return;
    }
    let views: DiffViews | null = null;
    let scrollbars: ProxyScrollbarsHandle[] = [];
    let unlinkScroll: (() => void) | null = null;
    let cancelled = false;
    void buildDiffViews({
      parent,
      left: docs.left,
      right: docs.right,
      path,
      themeId,
      fontFamily,
      fontSize,
      wordWrap,
      unified,
      unchangedLines: t("diffUnchangedLines"),
      foldLabels,
      onCollapseRegion: collapseRegion,
      commentHandlers,
      cancelled: () => cancelled,
    }).then((built) => {
      if (!built) {
        return;
      }
      views = built;
      viewsRef.current = built;
      if (built.kind === "unified") {
        // Inline scrolls in the editor itself, so it owns both bars. "x"
        // here would leave it with none at all in the vertical direction:
        // attaching proxies hides the scroller's own bars on both axes.
        scrollbars = [
          attachProxyScrollbars({ scroller: built.view.scrollDOM, host: parent, axes: "xy" }),
        ];
      } else {
        // Pin a bottom horizontal scrollbar per side (the native one lives at
        // the bottom of the full-height document, out of sight). Vertical
        // scrolling stays on the outer .cm-mergeView, so "x" only.
        const { a, b } = built.merge;
        scrollbars = [
          attachProxyScrollbars({ scroller: a.scrollDOM, host: parent, axes: "x" }),
          attachProxyScrollbars({ scroller: b.scrollDOM, host: parent, axes: "x" }),
        ];
        unlinkScroll = linkHorizontalScroll(a.scrollDOM, b.scrollDOM);
      }
      reanchorInto(built);
      setViewEpoch((epoch) => epoch + 1);
      // Land on the first change right away so the counter starts at 1/N and
      // the change is pinned in view.
      const chunks = currentChunks();
      setChunkPos({ current: chunks.length > 0 ? 1 : 0, total: chunks.length });
      if (chunks.length > 0) {
        scrollToChunk(chunks[0]);
      }
    });
    return () => {
      cancelled = true;
      viewsRef.current = null;
      unlinkScroll?.();
      for (const bar of scrollbars) {
        bar.destroy();
      }
      if (views) {
        destroyDiffViews(views);
      }
    };
  }, [docs, path, themeId, fontFamily, fontSize, wordWrap, unified]);


  // Fold one expanded stretch back up; the replay of what stays open lives
  // with the view builder, since both diff surfaces need it.
  function collapseRegion(side: "a" | "b", pos: number) {
    const views = viewsRef.current;
    if (views) {
      collapseDiffRegion(views, side, pos, docs?.left ?? "");
    }
  }

  function currentChunks(): readonly Chunk[] {
    return diffChunks(viewsRef.current);
  }

  // Pin a chunk to the top of whichever element actually scrolls: the outer
  // .cm-mergeView in split mode, the editor itself inline. lineBlockAt gives
  // document geometry without needing the line to be rendered, so this works
  // across collapsed regions too.
  function scrollToChunk(chunk: Chunk) {
    const views = viewsRef.current;
    if (!views) {
      return;
    }
    if (views.kind === "split") {
      const pos = Math.min(chunk.fromB, views.merge.b.state.doc.length);
      const top = views.merge.b.lineBlockAt(pos).top;
      const scroller = containerRef.current?.querySelector(".cm-mergeView");
      if (scroller) {
        scroller.scrollTop = Math.max(0, top - 8);
      }
      return;
    }
    // Inline paints the old lines as a widget just above the chunk, so anchor
    // one line earlier — landing on the chunk itself would scroll the deleted
    // half off the top.
    const { view } = views;
    const pos = Math.min(chunk.fromB, view.state.doc.length);
    const line = view.state.doc.lineAt(pos).number;
    const anchor = line > 1 ? view.state.doc.line(line - 1).from : 0;
    view.scrollDOM.scrollTop = Math.max(0, view.lineBlockAt(anchor).top - 8);
  }

  // Step the current/total counter and bring that chunk into view. Navigation
  // is index-based (not selection-based): a read-only diff has no visible
  // cursor, and with collapsed regions everything may already fit on screen.
  function goToChunk(direction: "prev" | "next") {
    const chunks = currentChunks();
    if (chunks.length === 0) {
      return;
    }
    const next =
      direction === "next"
        ? Math.min(chunkPos.current + 1, chunks.length)
        : Math.max(chunkPos.current - 1, 1);
    scrollToChunk(chunks[next - 1]);
    setChunkPos({ current: next, total: chunks.length });
  }

  const name = path.split(/[\\/]/).pop() ?? path;

  return (
    <div className="relative flex h-full flex-col bg-bg">
      <PaneHeader
        left={
          <div className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 truncate text-xs text-fg-muted">{name}</span>
            <span className="shrink-0 rounded bg-bg-elevated px-1.5 py-0.5 text-[10px] font-medium uppercase text-fg-subtle">
              {staged ? t("diffStaged") : t("diffUnstaged")}
            </span>
          </div>
        }
        actions={
          <>
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
            {/* Names and draws the mode it switches to, not the one in use —
                a two-way switch, so there is no "pressed" state to show. */}
            <Tooltip label={unified ? t("diffSplitView") : t("diffInlineView")}>
              <button
                type="button"
                aria-label={unified ? t("diffSplitView") : t("diffInlineView")}
                onClick={toggleUnified}
                className="rounded p-1 text-fg-muted hover:bg-bg-elevated hover:text-fg"
              >
                {unified ? (
                  <SquareSplitHorizontal size={14} />
                ) : (
                  <SquareSplitVertical size={14} />
                )}
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
            <Tooltip label={t("diffSendToAgent")}>
              <button
                type="button"
                aria-label={t("diffSendToAgent")}
                disabled={unsent === 0}
                onClick={(event) => {
                  setHintSeen(true);
                  setSendMenu({ x: event.clientX, y: event.clientY });
                }}
                className="flex items-center gap-1 rounded p-1 text-fg-muted hover:bg-bg-elevated hover:text-fg disabled:pointer-events-none disabled:opacity-40"
              >
                <Send size={14} />
                {unsent > 0 && (
                  <span className="font-mono text-[11px] leading-none">{unsent}</span>
                )}
              </button>
            </Tooltip>
          </>
        }
        showClose={showClose}
        onClose={() => onClose?.()}
      />
      {error ? (
        <p className="px-3 py-2 text-xs text-danger">{t("diffLoadError")}</p>
      ) : (
        <div
          ref={containerRef}
          className={`diff-merge-view min-h-0 flex-1 overflow-hidden ${
            unified ? "diff-inline-view" : ""
          }`}
        />
      )}
      {!hintSeen && !error && (
        // One-time pointer at the review-comment loop, anchored under the
        // send button with a notch, like the worktrees pane hint. The notch
        // shifts left when the pane's close button sits after the send button.
        // Any use of the feature — the "+" gutter or the send button — also
        // dismisses it.
        <div className="absolute right-3 top-8 z-20 w-72 rounded-lg border border-border-strong bg-bg-elevated p-3 shadow-xl">
          <span
            aria-hidden
            className={`absolute -top-[5px] h-2 w-2 rotate-45 border-l border-t border-border-strong bg-bg-elevated ${
              showClose ? "right-[31px]" : "right-[7px]"
            }`}
          />
          <p className="text-sm font-semibold text-fg">{t("diffCommentHintTitle")}</p>
          <p className="mt-1 text-sm leading-relaxed text-fg-muted">{t("diffCommentHintBody")}</p>
          <button
            type="button"
            onClick={() => setHintSeen(true)}
            className="mt-2 rounded py-1 text-sm text-accent transition-colors hover:text-fg"
          >
            {t("diffCommentHintDismiss")}
          </button>
        </div>
      )}
      {sendMenu && (
        <ContextMenu
          x={sendMenu.x}
          y={sendMenu.y}
          items={agentTargetMenuItems(t("diffNoAgentSession"))}
          onClose={() => setSendMenu(null)}
        />
      )}
    </div>
  );
}
