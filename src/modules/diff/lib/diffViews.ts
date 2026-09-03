/**
 * Building the editors one comparison is read in, shared by the single-file
 * diff tab and the concatenated all-changes view. Both surfaces read code the
 * same way — same collapsing, same type, same comment gutter — so the setup
 * lives here rather than being kept in step by hand in two places.
 *
 * Height and scrolling are deliberately NOT set here: the single-file tab
 * scrolls the merge container, and a section of the concatenated view grows to
 * its content and lets the page scroll. That belongs to the caller's CSS.
 */

import {
  getChunks,
  MergeView,
  uncollapseUnchanged,
  unifiedMergeView,
  type Chunk,
} from "@codemirror/merge";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { loadLanguageExtension } from "@/modules/editor/lib/language";
import { editorSyntaxTheme } from "@/themes/editorTheme";
import {
  clearExpandedEffect,
  collapseBackExtension,
  expandedRegions,
} from "./collapseBack";
import { diffCommentsExtension, type CommentHandlers } from "./diffCommentsExtension";

/**
 * Collapse long unchanged stretches into an expandable bar (VS Code style),
 * so a large file reads as just its changes.
 */
export const COLLAPSE_UNCHANGED = { margin: 3, minSize: 5 };

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
export const DIFF_CONFIG = { timeout: 1000 };

/** The inline mode's merge extension, rebuilt whenever the bars are reset. */
export function unifiedExtension(original: string) {
  return unifiedMergeView({
    original,
    gutter: true,
    // The accept/reject controls write to the document; these surfaces only
    // read one.
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
export type DiffViews =
  | { kind: "split"; merge: MergeView }
  | { kind: "unified"; view: EditorView; collapse: Compartment };

export interface DiffViewOptions {
  parent: HTMLElement;
  /** Old side (index or HEAD). */
  left: string;
  /** New side (working tree or index). */
  right: string;
  /** The file's path — grammar detection only, never read from disk here. */
  path: string;
  themeId: string;
  fontFamily: string;
  fontSize: number;
  wordWrap: boolean;
  /** Inline (one document) instead of side-by-side. */
  unified: boolean;
  /** Localized "$ unchanged lines" for the collapsed bars. */
  unchangedLines: string;
  foldLabels: { fold: string; unfold: string };
  /** Fold one expanded stretch back up — see `collapseDiffRegion`. */
  onCollapseRegion: (side: "a" | "b", pos: number) => void;
  commentHandlers: (side: "a" | "b") => CommentHandlers;
  /**
   * Checked after the grammar loads: the caller's effect may have been torn
   * down while waiting, and building into a detached parent would leak two
   * editors.
   */
  cancelled?: () => boolean;
}

/**
 * Build the editors into `options.parent`. Returns null when the caller
 * cancelled during the (async) grammar load. A failed grammar load falls back
 * to plain text instead of leaving the surface without a diff.
 */
export async function buildDiffViews(options: DiffViewOptions): Promise<DiffViews | null> {
  const language = await loadLanguageExtension(options.path).catch(() => []);
  if (options.cancelled?.()) {
    return null;
  }
  const {
    parent,
    left,
    right,
    themeId,
    fontFamily,
    fontSize,
    wordWrap,
    unified,
    unchangedLines,
    foldLabels,
    onCollapseRegion,
    commentHandlers,
  } = options;

  const extensions = [
    EditorState.readOnly.of(true),
    EditorView.editable.of(false),
    // Localizes the collapsed-region bar ("$ unchanged lines").
    EditorState.phrases.of({ "$ unchanged lines": unchangedLines }),
    editorSyntaxTheme(themeId),
    EditorView.theme({
      "&": { fontSize: `${fontSize}px` },
      ".cm-content, .cm-gutters, .cm-scroller": { fontFamily },
    }),
    lineNumbers(),
    ...(wordWrap ? [EditorView.lineWrapping] : []),
    ...language,
  ];

  // Inline has no reconfigure() of its own, so its merge extension goes in a
  // compartment the fold button can re-init (see collapseDiffRegion).
  const collapse = new Compartment();
  if (unified) {
    const view = new EditorView({
      doc: right,
      parent,
      extensions: [
        // First in the list means leftmost gutter, out at the surface edge.
        collapseBackExtension(foldLabels, (pos) => onCollapseRegion("b", pos)),
        ...extensions,
        diffCommentsExtension(commentHandlers("b")),
        collapse.of(unifiedExtension(left)),
      ],
    });
    return { kind: "unified", view, collapse };
  }
  const merge = new MergeView({
    a: {
      doc: left,
      extensions: [
        collapseBackExtension(foldLabels, (pos) => onCollapseRegion("a", pos)),
        ...extensions,
        diffCommentsExtension(commentHandlers("a")),
      ],
    },
    b: {
      doc: right,
      extensions: [
        collapseBackExtension(foldLabels, (pos) => onCollapseRegion("b", pos)),
        ...extensions,
        diffCommentsExtension(commentHandlers("b")),
      ],
    },
    parent,
    gutter: true,
    collapseUnchanged: COLLAPSE_UNCHANGED,
    diffConfig: DIFF_CONFIG,
  });
  return { kind: "split", merge };
}

export function destroyDiffViews(views: DiffViews): void {
  if (views.kind === "split") {
    views.merge.destroy();
  } else {
    views.view.destroy();
  }
}

/**
 * The editor a comment side lives in, or null when the current mode has no
 * such editor (inline has no "a" document).
 */
export function diffSideView(views: DiffViews | null, side: "a" | "b"): EditorView | null {
  if (!views) {
    return null;
  }
  if (views.kind === "split") {
    return side === "a" ? views.merge.a : views.merge.b;
  }
  return side === "b" ? views.view : null;
}

/** Both modes count the same chunks; only the state carrying them differs. */
export function diffChunks(views: DiffViews | null): readonly Chunk[] {
  if (!views) {
    return [];
  }
  const state = views.kind === "split" ? views.merge.b.state : views.view.state;
  return getChunks(state)?.chunks ?? [];
}

/**
 * Fold one expanded stretch back up. @codemirror/merge can only rebuild every
 * bar at once, so the ones the reader still wants open are replayed on top of
 * the rebuild. The editors themselves are left alone, which keeps the scroll
 * position.
 */
export function collapseDiffRegion(
  views: DiffViews,
  side: "a" | "b",
  pos: number,
  left: string,
): void {
  if (views.kind === "unified") {
    const { view } = views;
    const keep = view.state.field(expandedRegions).filter((p) => p !== pos);
    view.dispatch({
      effects: [
        views.collapse.reconfigure(unifiedExtension(left)),
        clearExpandedEffect.of(null),
      ],
    });
    view.dispatch({ effects: keep.map((p) => uncollapseUnchanged.of(p)) });
    return;
  }
  // Split: the same stretch sits at a different offset on each side, and the
  // library expands both together — so the two lists line up one for one and
  // the clicked entry is dropped by index, not by position.
  const clicked = side === "a" ? views.merge.a : views.merge.b;
  const index = clicked.state.field(expandedRegions).indexOf(pos);
  if (index < 0) {
    return;
  }
  // No diffConfig here on purpose: reconfigure() reads it as `"diffConfig" in config`,
  // so leaving the key out keeps the one the view was built with. Passing it
  // again would read as if it did something.
  views.merge.reconfigure({ collapseUnchanged: COLLAPSE_UNCHANGED });
  for (const view of [views.merge.a, views.merge.b]) {
    const keep = view.state.field(expandedRegions).filter((_, i) => i !== index);
    view.dispatch({
      effects: [clearExpandedEffect.of(null), ...keep.map((p) => uncollapseUnchanged.of(p))],
    });
  }
}
