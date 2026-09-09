import { gutter, GutterMarker } from "@codemirror/view";
import { type Extension } from "@codemirror/state";
import {
  barredRuns,
  foldRun,
  openedRuns,
  runKeyAt,
  RunWidget,
  unfoldRun,
} from "./collapseRuns";
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
      // A stretch with nothing left hidden has no bar to hang an icon beside,
      // so its way back sits on the line it starts at instead.
      lineMarker: (view, line) =>
        openedRuns(view.state).has(line.from) && !barredRuns(view.state).has(line.from)
          ? new IconMarker(line.from, "fold", labels.fold)
          : null,
      // Beside a bar the icon says what pressing it will do, which depends on
      // whether the stretch has been opened at all: shut it again, or open the
      // rest of it.
      widgetMarker: (view, widget, block) => {
        if (!(widget instanceof RunWidget)) {
          return null;
        }
        const opened = openedRuns(view.state).has(widget.start);
        return new IconMarker(
          block.from,
          opened ? "fold" : "unfold",
          opened ? labels.fold : labels.unfold,
        );
      },
      lineMarkerChange: (update) =>
        openedRuns(update.startState) !== openedRuns(update.state),
      domEventHandlers: {
        mousedown(view, block, event) {
          // By the stretch the block belongs to, never by where the block is
          // drawn: opening the top edge moves the bar down, and a key taken
          // from its new position matches no stretch at all.
          const key = runKeyAt(view.state, block.from);
          if (key === null) {
            return false;
          }
          const line = view.state.doc.lineAt(block.from);
          const onBar = block.to > line.to;
          if (!onBar && !openedRuns(view.state).has(block.from)) {
            return false;
          }
          event.preventDefault();
          if (openedRuns(view.state).has(key)) {
            foldRun(view, key);
          } else {
            unfoldRun(view, key);
          }
          return true;
        },
      },
    }),
  ];
}
