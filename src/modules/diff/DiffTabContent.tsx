import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  ChevronUp,
  Send,
  SquareSplitHorizontal,
  SquareSplitVertical,
  SquareTerminal,
  WrapText,
} from "lucide-react";
import {
  getChunks,
  MergeView,
  uncollapseUnchanged,
  unifiedMergeView,
  type Chunk,
} from "@codemirror/merge";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { PaneHeader } from "@/components/PaneHeader";
import { Tooltip } from "@/components/Tooltip";
import { ContextMenu, type ContextMenuItem } from "@/components/ContextMenu";
import { gitFileAtRev, gitResolveRepo } from "@/modules/source-control/lib/gitBridge";
import { fsReadFile } from "@/modules/explorer/lib/fsBridge";
import { loadLanguageExtension } from "@/modules/editor/lib/language";
import { attachProxyScrollbars, type ProxyScrollbarsHandle } from "@/lib/proxyScrollbar";
import { linkHorizontalScroll } from "./lib/linkScroll";
import { dirname, relativePath } from "@/modules/explorer/lib/paths";
import { editorSyntaxTheme } from "@/themes/editorTheme";
import { selectTerminalFontFamily, useFontStore } from "@/stores/fontStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useTabsStore } from "@/stores/tabsStore";
import { useSessionStatusStore } from "@/modules/claude-progress/lib/sessionStatusStore";
import { pasteToTerminal } from "@/modules/terminal/lib/terminalBus";
import { useDiffCommentStore } from "./lib/diffCommentStore";
import { formatCommentPrompt, reanchorComments } from "./lib/commentPrompt";
import { collectAgentTargets, type AgentTarget } from "./lib/agentTargets";
import {
  clearExpandedEffect,
  collapseBackExtension,
  expandedRegions,
} from "./lib/collapseBack";
import {
  diffCommentsExtension,
  setCommentsEffect,
  setDraftEffect,
  type CommentHandlers,
} from "./lib/diffCommentsExtension";

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
 * Collapse long unchanged stretches into an expandable bar (VS Code style),
 * so a large file reads as just its changes.
 */
const COLLAPSE_UNCHANGED = { margin: 3, minSize: 5 };

/**
 * @codemirror/merge defaults to `{ scanLimit: 500 }`, which abandons the
 * precise diff once a differing range passes 4,000 characters and marks the
 * whole range replaced past 16,000. That measures the wrong thing: the
 * algorithm is O(N*D) in the number of differences, so a file with a few
 * changes spread far apart is cheap to diff exactly and yet trips a limit set
 * on range size alone. A 13,890-line resource file with 24 added lines came
 * out as the entire file deleted and added back, against git's own +24 -0.
 *
 * Measured on that file (450KB): the default marks 107,763 characters as
 * deleted in 0.8ms, where an unlimited scan is exact in 11ms.
 *
 * So the budget is time, not size. 1000ms sits above the worst case worth
 * being precise about -- 500 changed lines scattered through a large file,
 * exact in ~530ms -- and a shorter deadline is not only less precise but
 * slower, because every range that misses it falls back to a crude match that
 * costs more on a wide range than finishing the scan would have (300ms
 * measured at 1653ms, against 411ms unlimited). Two genuinely unrelated large
 * files, the case the scan limit is there for, give up at ~930ms.
 */
const DIFF_CONFIG = { timeout: 1000 };

/** The inline mode's merge extension, rebuilt whenever the bars are reset. */
function unifiedExtension(original: string) {
  return unifiedMergeView({
    original,
    gutter: true,
    // The accept/reject controls write to the document; this tab only reads one.
    mergeControls: false,
    collapseUnchanged: COLLAPSE_UNCHANGED,
    diffConfig: DIFF_CONFIG,
  });
}

/**
 * The two ways the same comparison is rendered. Split keeps a document per
 * side; inline keeps only the new document and paints the old lines in as
 * widgets, so it has no "a" editor to talk to.
 */
type DiffViews =
  | { kind: "split"; merge: MergeView }
  | { kind: "unified"; view: EditorView; collapse: Compartment };

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
  // Review comments for the agent: this file's render inside the editors, the
  // unsent count across all files feeds the batch-send button.
  const allComments = useDiffCommentStore((s) => s.comments);
  const fileComments = useMemo(
    () => allComments.filter((c) => c.path === path && c.staged === staged),
    [allComments, path, staged],
  );
  const unsent = useMemo(() => allComments.filter((c) => !c.sent), [allComments]);
  const [draft, setDraft] = useState<{ side: "a" | "b"; line: number } | null>(null);
  // The draft's text lives in a ref (not state): the widget reads it back on
  // rebuild — view recreation, draft moved to another line — so typed text is
  // never lost, and keystrokes don't re-render the component.
  const draftBodyRef = useRef("");
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

  // The editor a comment side lives in, or null when the current mode has
  // no such editor (inline has no "a" document).
  function sideView(side: "a" | "b"): EditorView | null {
    const views = viewsRef.current;
    if (!views) {
      return null;
    }
    if (views.kind === "split") {
      return side === "a" ? views.merge.a : views.merge.b;
    }
    return side === "b" ? views.view : null;
  }

  // Wire the comment extension's callbacks. Created per side inside the
  // view effect so the saved line text is read from that side's doc.
  function commentHandlers(side: "a" | "b"): CommentHandlers {
    return {
      // Clicking another line moves the draft there, carrying its text —
      // never silently saving and never discarding what was typed.
      onAdd: (line) => {
        useSettingsStore.getState().setDiffCommentHintSeen(true);
        setDraft({ side, line });
      },
      onSave: (line, body) => {
        const view = sideView(side);
        const clamped = view ? Math.max(1, Math.min(line, view.state.doc.lines)) : line;
        const lineText = view ? view.state.doc.line(clamped).text : "";
        useDiffCommentStore.getState().add({ path, staged, side, line: clamped, lineText, body });
        draftBodyRef.current = "";
        setDraft(null);
      },
      onCancel: () => {
        draftBodyRef.current = "";
        setDraft(null);
      },
      onDelete: (id) => useDiffCommentStore.getState().remove(id),
      getDraftBody: () => draftBodyRef.current,
      onDraftChange: (text) => {
        draftBodyRef.current = text;
      },
      labels: {
        add: t("diffCommentAdd"),
        placeholder: t("diffCommentPlaceholder"),
        save: t("diffCommentSave"),
        cancel: t("diffCommentCancel"),
        delete: t("diffCommentDelete"),
        sent: t("diffCommentSent"),
      },
    };
  }

  useEffect(() => {
    const parent = containerRef.current;
    if (!docs || !parent) {
      return;
    }
    let views: DiffViews | null = null;
    let scrollbars: ProxyScrollbarsHandle[] = [];
    let unlinkScroll: (() => void) | null = null;
    let cancelled = false;
    // A failed grammar load falls back to plain text instead of leaving the
    // tab stuck without a diff.
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
        // Inline has no reconfigure() of its own, so its merge extension goes
        // in a compartment the fold button can re-init (see recollapse below).
        const collapse = new Compartment();
        if (unified) {
          const view = new EditorView({
            doc: docs.right,
            parent,
            extensions: [
              // First in the list means leftmost gutter, out at the pane edge.
              collapseBackExtension(foldLabels, (pos) =>
                collapseRegion("b", pos),
              ),
              ...extensions,
              diffCommentsExtension(commentHandlers("b")),
              collapse.of(unifiedExtension(docs.left)),
            ],
          });
          views = { kind: "unified", view, collapse };
          // Inline scrolls in the editor itself, so it owns both bars. "x"
          // here would leave it with none at all in the vertical direction:
          // attaching proxies hides the scroller's own bars on both axes.
          scrollbars = [
            attachProxyScrollbars({ scroller: view.scrollDOM, host: parent, axes: "xy" }),
          ];
        } else {
          const merge = new MergeView({
            a: {
              doc: docs.left,
              extensions: [
                collapseBackExtension(foldLabels, (pos) =>
                  collapseRegion("a", pos),
                ),
                ...extensions,
                diffCommentsExtension(commentHandlers("a")),
              ],
            },
            b: {
              doc: docs.right,
              extensions: [
                collapseBackExtension(foldLabels, (pos) =>
                  collapseRegion("b", pos),
                ),
                ...extensions,
                diffCommentsExtension(commentHandlers("b")),
              ],
            },
            parent,
            gutter: true,
            collapseUnchanged: COLLAPSE_UNCHANGED,
            diffConfig: DIFF_CONFIG,
          });
          views = { kind: "split", merge };
          // Pin a bottom horizontal scrollbar per side (the native one lives at
          // the bottom of the full-height document, out of sight). Vertical
          // scrolling stays on the outer .cm-mergeView, so "x" only.
          scrollbars = [
            attachProxyScrollbars({ scroller: merge.a.scrollDOM, host: parent, axes: "x" }),
            attachProxyScrollbars({ scroller: merge.b.scrollDOM, host: parent, axes: "x" }),
          ];
          unlinkScroll = linkHorizontalScroll(merge.a.scrollDOM, merge.b.scrollDOM);
        }
        viewsRef.current = views;
        // Re-anchor comments whose line shifted while the docs were reloading,
        // then let the dispatch effect below render them into the new editors.
        const store = useDiffCommentStore.getState();
        for (const side of ["a", "b"] as const) {
          const view = sideView(side);
          if (!view) {
            continue;
          }
          const doc = view.state.doc.toString().split("\n");
          const sideComments = store.comments.filter(
            (c) => c.path === path && c.staged === staged && c.side === side,
          );
          store.reanchor(reanchorComments(sideComments, doc));
        }
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
      if (views?.kind === "split") {
        views.merge.destroy();
      } else {
        views?.view.destroy();
      }
    };
  }, [docs, path, themeId, fontFamily, wordWrap, unified]);

  // Push the current comment set and draft into both editors whenever either
  // changes (or the MergeView was rebuilt). The extension renders from these
  // effects; the store stays the single source of truth.
  useEffect(() => {
    for (const side of ["a", "b"] as const) {
      const view = sideView(side);
      if (!view) {
        continue;
      }
      view.dispatch({
        effects: [
          setCommentsEffect.of(
            fileComments
              .filter((c) => c.side === side)
              .map(({ id, line, body, sent }) => ({ id, line, body, sent })),
          ),
          setDraftEffect.of(draft && draft.side === side ? draft.line : null),
        ],
      });
    }
  }, [fileComments, draft, viewEpoch]);

  // Batch-send every unsent comment (across files) to the picked agent pane.
  // The prompt is pasted, not submitted: bracketed paste puts it in the
  // agent's input box so the user reviews and presses Enter there.
  function sendToAgent(target: AgentTarget) {
    const batch = useDiffCommentStore.getState().comments.filter((c) => !c.sent);
    if (batch.length === 0) {
      return;
    }
    pasteToTerminal(target.leafId, formatCommentPrompt(batch));
    useDiffCommentStore.getState().markSent(batch.map((c) => c.id));
    useTabsStore.getState().setActive(target.tabId);
  }

  function sendMenuItems(): ContextMenuItem[] {
    const targets = collectAgentTargets(
      useTabsStore.getState().tabs,
      useSessionStatusStore.getState().statuses,
      useSessionStatusStore.getState().agents,
    );
    if (targets.length === 0) {
      return [
        {
          id: "no-agent",
          label: t("diffNoAgentSession"),
          icon: SquareTerminal,
          disabled: true,
          onSelect: () => {},
        },
      ];
    }
    return targets.map((target) => ({
      id: target.leafId,
      label: target.label,
      icon: SquareTerminal,
      onSelect: () => sendToAgent(target),
    }));
  }

  // Fold one expanded stretch back up. @codemirror/merge can only rebuild
  // every bar at once, so the ones the reader still wants open are replayed
  // on top of the rebuild. The editors themselves are left alone, which keeps
  // the scroll position.
  function collapseRegion(side: "a" | "b", pos: number) {
    const views = viewsRef.current;
    if (!views) {
      return;
    }
    if (views.kind === "unified") {
      const { view } = views;
      const keep = view.state.field(expandedRegions).filter((p) => p !== pos);
      view.dispatch({
        effects: [
          views.collapse.reconfigure(unifiedExtension(docs?.left ?? "")),
          clearExpandedEffect.of(null),
        ],
      });
      view.dispatch({ effects: keep.map((p) => uncollapseUnchanged.of(p)) });
      return;
    }
    // Split: the same stretch sits at a different offset on each side, and
    // the library expands both together — so the two lists line up one for
    // one and the clicked entry is dropped by index, not by position.
    const clicked = side === "a" ? views.merge.a : views.merge.b;
    const index = clicked.state.field(expandedRegions).indexOf(pos);
    if (index < 0) {
      return;
    }
    views.merge.reconfigure({ collapseUnchanged: COLLAPSE_UNCHANGED, diffConfig: DIFF_CONFIG });
    for (const view of [views.merge.a, views.merge.b]) {
      const keep = view.state.field(expandedRegions).filter((_, i) => i !== index);
      view.dispatch({
        effects: [clearExpandedEffect.of(null), ...keep.map((p) => uncollapseUnchanged.of(p))],
      });
    }
  }

  // Both modes count the same chunks; only the state carrying them differs.
  function currentChunks(): readonly Chunk[] {
    const views = viewsRef.current;
    if (!views) {
      return [];
    }
    const state = views.kind === "split" ? views.merge.b.state : views.view.state;
    return getChunks(state)?.chunks ?? [];
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
                disabled={unsent.length === 0}
                onClick={(event) => {
                  setHintSeen(true);
                  setSendMenu({ x: event.clientX, y: event.clientY });
                }}
                className="flex items-center gap-1 rounded p-1 text-fg-muted hover:bg-bg-elevated hover:text-fg disabled:pointer-events-none disabled:opacity-40"
              >
                <Send size={14} />
                {unsent.length > 0 && (
                  <span className="font-mono text-[11px] leading-none">{unsent.length}</span>
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
          items={sendMenuItems()}
          onClose={() => setSendMenu(null)}
        />
      )}
    </div>
  );
}
