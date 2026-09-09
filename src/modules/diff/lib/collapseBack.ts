import { gutter, GutterMarker } from "@codemirror/view";
import { type Extension } from "@codemirror/state";
import { foldRun, openedRuns, RunWidget, unfoldRun } from "./collapseRuns";
import { FOLD_VERTICAL, lucideIcon, UNFOLD_VERTICAL } from "./lucideDom";
import { withGutterHint } from "./gutterHint";

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
 * A fold icon on the first line of every unchanged stretch the reader has
 * opened. The column carries no marker when a file has none open, so it costs
 * no width there.
 *
 * Only the fold half now: the bars carry their own controls for opening (see
 * collapseRuns.ts), but a stretch opened all the way leaves no bar behind, so
 * the way back has to live in the gutter.
 */
export function collapseBackExtension(labels: { fold: string; unfold: string }): Extension {
  return [
    gutter({
      class: "cm-diff-fold-gutter",
      lineMarker: (view, line) =>
        openedRuns(view.state).has(line.from)
          ? new IconMarker(line.from, "fold", labels.fold)
          : null,
      widgetMarker: (_view, widget, block) =>
        widget instanceof RunWidget ? new IconMarker(block.from, "unfold", labels.unfold) : null,
      lineMarkerChange: (update) =>
        openedRuns(update.startState) !== openedRuns(update.state),
      domEventHandlers: {
        mousedown(view, block, event) {
          if (openedRuns(view.state).has(block.from)) {
            event.preventDefault();
            foldRun(view, block.from);
            return true;
          }
          // A collapsed stretch is one block, so its gutter cell covers more
          // than the line it starts on; that is what tells the two apart.
          const line = view.state.doc.lineAt(block.from);
          if (block.to <= line.to) {
            return false;
          }
          event.preventDefault();
          unfoldRun(view, block.from);
          return true;
        },
      },
    }),
  ];
}
