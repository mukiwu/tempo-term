import { EditorView, gutter, GutterMarker } from "@codemirror/view";
import { StateEffect, StateField, type Extension } from "@codemirror/state";
import {
  getChunks,
  mergeViewSiblings,
  uncollapseUnchanged,
  type Chunk,
} from "@codemirror/merge";
import { FOLD_VERTICAL, lucideIcon, UNFOLD_VERTICAL } from "./lucideDom";
import { withGutterHint } from "./gutterHint";

/**
 * Forget every tracked expansion. Dispatched right after the collapsed bars
 * are rebuilt, so the ones that stay open can be replayed on top.
 */
export const clearExpandedEffect = StateEffect.define<null>();

/**
 * Where the reader expanded an unchanged stretch, in document order.
 *
 * @codemirror/merge consumes its "N unchanged lines" bar on the way out and
 * offers no way back, so this remembers the positions those bars sat at. The
 * library dispatches the same effect to both sides of a MergeView, which is
 * what lets the two sides be paired up by index when one is folded back.
 */
export const expandedRegions = StateField.define<readonly number[]>({
  create: () => [],
  update(value, tr) {
    let next = value;
    for (const effect of tr.effects) {
      if (effect.is(clearExpandedEffect)) {
        next = [];
      } else if (effect.is(uncollapseUnchanged) && !next.includes(effect.value)) {
        next = [...next, effect.value].sort((a, b) => a - b);
      }
    }
    return next;
  },
});

/** The type tag @codemirror/merge gives its collapsed-lines block widget. */
const COLLAPSED_WIDGET = "collapsed-unchanged-code";

class IconMarker extends GutterMarker {
  constructor(
    readonly pos: number,
    readonly kind: "fold" | "unfold",
    readonly label: string,
  ) {
    super();
  }

  eq(other: IconMarker): boolean {
    return other.pos === this.pos && other.kind === this.kind && other.label === this.label;
  }

  toDOM(): Node {
    const el = document.createElement("span");
    el.className = this.kind === "fold" ? "cm-diff-fold" : "cm-diff-unfold";
    el.appendChild(lucideIcon(this.kind === "fold" ? FOLD_VERTICAL : UNFOLD_VERTICAL));
    return withGutterHint(el, this.label);
  }
}

/**
 * Translate a position in unchanged text to the same text on the other side of
 * a MergeView. Mirrors the mapping the library's own collapsed bar does
 * internally so that clicking it opens both sides at once.
 */
function mapAcross(pos: number, chunks: readonly Chunk[], fromA: boolean): number {
  let ours = 0;
  let theirs = 0;
  for (const chunk of chunks) {
    if ((fromA ? chunk.fromA : chunk.fromB) >= pos) {
      break;
    }
    [ours, theirs] = fromA ? [chunk.toA, chunk.toB] : [chunk.toB, chunk.toA];
  }
  return theirs + (pos - ours);
}

/** Open one collapsed stretch, keeping the other side of a split in step. */
function expandRegion(view: EditorView, pos: number) {
  view.dispatch({ effects: uncollapseUnchanged.of(pos) });
  const siblings = mergeViewSiblings(view);
  if (!siblings) {
    return;
  }
  const info = getChunks(view.state);
  const other = siblings.a === view ? siblings.b : siblings.a;
  other.dispatch({
    effects: uncollapseUnchanged.of(mapAcross(pos, info?.chunks ?? [], info?.side === "a")),
  });
}

/**
 * A gutter that opens and closes the unchanged stretches: an unfold icon
 * beside each "N unchanged lines" bar, and a fold icon on the first line of
 * every stretch that is open. The column carries no marker when a file has
 * neither, so it costs no width there.
 *
 * Opening is self-contained; folding back needs the whole bar set rebuilt, so
 * `onCollapse` hands that to the host — the only thing that knows about the
 * other side of the diff.
 */
export function collapseBackExtension(
  labels: { fold: string; unfold: string },
  onCollapse: (pos: number) => void,
): Extension {
  return [
    expandedRegions,
    gutter({
      class: "cm-diff-fold-gutter",
      lineMarker: (view, line) =>
        view.state.field(expandedRegions).includes(line.from)
          ? new IconMarker(line.from, "fold", labels.fold)
          : null,
      widgetMarker: (_view, widget, block) =>
        (widget as { type?: unknown }).type === COLLAPSED_WIDGET
          ? new IconMarker(block.from, "unfold", labels.unfold)
          : null,
      lineMarkerChange: (update) =>
        update.startState.field(expandedRegions) !== update.state.field(expandedRegions),
      domEventHandlers: {
        mousedown(view, block, event) {
          if (view.state.field(expandedRegions).includes(block.from)) {
            event.preventDefault();
            onCollapse(block.from);
            return true;
          }
          // A collapsed stretch is replaced by one block, so its gutter cell
          // covers more than the single line it starts on.
          const line = view.state.doc.lineAt(block.from);
          if (block.to <= line.to) {
            return false;
          }
          event.preventDefault();
          expandRegion(view, block.from);
          return true;
        },
      },
    }),
  ];
}
