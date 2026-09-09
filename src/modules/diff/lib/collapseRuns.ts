import { getChunks, mergeViewSiblings } from "@codemirror/merge";
import { StateEffect, StateField, type EditorState, type Extension } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { CHEVRONS_DOWN, CHEVRONS_UP, lucideIcon, UNFOLD_VERTICAL } from "./lucideDom";
import { withGutterHint } from "./gutterHint";

/**
 * The unchanged stretches of a diff, folded into a bar of our own.
 *
 * @codemirror/merge has `collapseUnchanged`, and this replaces it. Its bar
 * says how many lines are hidden and opens all of them at once, and its widget
 * text is `state.phrase("$ unchanged lines", lines)` — one number, hard-coded,
 * with the class not exported. Two things we want cannot be said through that
 * hole: which function the hidden run leads into, and "open twenty lines"
 * rather than "open all four hundred".
 *
 * So the runs are computed here from the chunk list the library does export,
 * and the bar is ours. What the library still does for us is the part worth
 * keeping: it aligns the two sides by measuring their rendered heights every
 * frame, so a bar of any height on either side is compensated for without this
 * file knowing anything about it.
 */

/** Lines left visible either side of a change, so it reads in context. */
const MARGIN = 3;
/** Shorter runs are not worth a bar: the bar is a line of its own. */
const MIN_RUN = 5;
/**
 * Lines one press of the up/down control reveals.
 *
 * Twenty because that is what GitHub's expander and VS Code's
 * `revealLineCount` both do, so it is the number a reader's hand already
 * expects. What matters more than the number is what it leaves behind, which
 * is what `MIN_RUN` settles below.
 */
export const STEP = 20;

/** How much of one run the reader has opened, from each end. */
interface Opened {
  top: number;
  bottom: number;
}

const NOTHING: Opened = { top: 0, bottom: 0 };

export interface RunLabels {
  /** "$ unchanged lines", with `$` standing in for the count. */
  unchanged: string;
  up: string;
  down: string;
  all: string;
  fold: string;
}

/** Open part of a run, or all of it. `start` is the run's first line. */
export const openRun = StateEffect.define<{ start: number; how: "top" | "bottom" | "all" }>();

/** Fold one run back up. */
export const closeRun = StateEffect.define<number>();

/** Forget every expansion — the documents underneath have been replaced. */
export const closeAllRuns = StateEffect.define<null>();

/**
 * What the reader has opened, keyed by the position each run starts at.
 *
 * Keyed by position rather than by index because a run's index shifts when the
 * diff is recomputed, and the reader's place should not move with it.
 */
const opened = StateField.define<ReadonlyMap<number, Opened>>({
  create: () => new Map(),
  update(value, tr) {
    let next = value;
    for (const effect of tr.effects) {
      if (effect.is(closeAllRuns)) {
        next = new Map();
      } else if (effect.is(closeRun)) {
        if (next.has(effect.value)) {
          const map = new Map(next);
          map.delete(effect.value);
          next = map;
        }
      } else if (effect.is(openRun)) {
        const was = next.get(effect.value.start) ?? NOTHING;
        const map = new Map(next);
        map.set(
          effect.value.start,
          effect.value.how === "all"
            ? { top: Number.MAX_SAFE_INTEGER, bottom: 0 }
            : effect.value.how === "top"
              ? { ...was, top: was.top + STEP }
              : { ...was, bottom: was.bottom + STEP },
        );
        next = map;
      }
    }
    if (next !== value || !tr.docChanged) {
      return next;
    }
    // Read-only documents, so this only happens when a surface reconfigures;
    // the keys still have to follow the text they were taken from.
    const moved = new Map<number, Opened>();
    for (const [pos, how] of next) {
      moved.set(tr.changes.mapPos(pos), how);
    }
    return moved;
  },
});

interface Run {
  /** First line of the unchanged stretch. */
  from: number;
  /** End of its last line. */
  to: number;
  /** Lines in the stretch. */
  lines: number;
}

/**
 * The unchanged stretches worth folding: the gaps between changes, trimmed by
 * `MARGIN` lines at each end so a change is never flush against a bar.
 */
function runsOf(state: EditorState): Run[] {
  const info = getChunks(state);
  if (!info) {
    return [];
  }
  const doc = state.doc;
  const out: Run[] = [];
  // In line numbers throughout: a chunk's end offset can sit inside its last
  // line or at the start of the next one, and trimming a margin off a byte
  // offset makes the two ends of a run come out a line apart.
  const add = (firstLine: number, lastLine: number, atStart: boolean, atEnd: boolean) => {
    const first = Math.max(1, firstLine + (atStart ? 0 : MARGIN));
    const last = Math.min(doc.lines, lastLine - (atEnd ? 0 : MARGIN));
    if (last - first + 1 < MIN_RUN) {
      return;
    }
    out.push({ from: doc.line(first).from, to: doc.line(last).to, lines: last - first + 1 });
  };
  let nextFirst = 1;
  for (const chunk of info.chunks) {
    const from = info.side === "a" ? chunk.fromA : chunk.fromB;
    const to = info.side === "a" ? chunk.toA : chunk.toB;
    const changeFirst = doc.lineAt(Math.min(from, doc.length)).number;
    // The last character the chunk owns, not the position after it: a chunk
    // ends at the start of the following line as often as at the end of its
    // own, and only one of those two answers is the line that changed.
    const last = Math.min(to > from ? to - 1 : to, doc.length);
    const changeLast = doc.lineAt(last).number;
    add(nextFirst, changeFirst - 1, nextFirst === 1, false);
    nextFirst = changeLast + 1;
  }
  add(nextFirst, doc.lines, info.chunks.length === 0, true);
  return out;
}

/**
 * The declaration the code after a run sits inside — git's own heuristic: the
 * nearest line above that starts in the first column with a letter, `_` or `$`.
 *
 * Read from below the run rather than above it. What a reader wants off a bar
 * is where it is about to land, which is the same thing git puts after the
 * `@@` of the hunk that follows: "the changes below are inside this".
 */
function leadsInto(state: EditorState, run: Run): string {
  const doc = state.doc;
  const after = Math.min(doc.lineAt(run.to).number + 1, doc.lines);
  for (let n = after; n >= 1; n -= 1) {
    const text = doc.line(n).text;
    if (/^[A-Za-z_$]/.test(text)) {
      return text.trim().replace(/[{(:]\s*$/, "");
    }
  }
  return "";
}

function button(
  label: string,
  paths: readonly string[],
  enabled: boolean,
  onClick: () => void,
): HTMLElement {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "cm-diff-run-btn";
  el.disabled = !enabled;
  el.append(lucideIcon(paths, 12));
  el.setAttribute("aria-label", label);
  el.addEventListener("mousedown", (event) => {
    // The editor would otherwise take the click as a click on the text.
    event.preventDefault();
    event.stopPropagation();
    if (enabled) {
      onClick();
    }
  });
  // The app's own hover hint rather than `title`, which the macOS WebView is
  // unreliable about and which a split diff's overflow would clip -- the same
  // reason the fold gutter next door uses it. A dead arrow gets none: a
  // control that will not act should not describe an act.
  return enabled ? withGutterHint(el, label) : el;
}

export class RunWidget extends WidgetType {
  constructor(
    readonly start: number,
    readonly lines: number,
    readonly name: string,
    /** Nothing above this bar: it is the first thing in the file. */
    readonly atStart: boolean,
    /** Nothing below it: it runs to the end of the file. */
    readonly atEnd: boolean,
    readonly labels: RunLabels,
  ) {
    super();
  }

  eq(other: RunWidget): boolean {
    return (
      other.start === this.start &&
      other.lines === this.lines &&
      other.name === this.name &&
      other.atStart === this.atStart &&
      other.atEnd === this.atEnd
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const outer = document.createElement("div");
    outer.className = "cm-diff-run";
    // The number as data as well as words: the words are localized, and both
    // styling and tests want the number without parsing a sentence.
    outer.dataset.lines = String(this.lines);
    // Everything left-aligned and in one run of content. A block widget is as
    // wide as the document, not as the pane, so anything pushed to its right
    // edge sits off the side of any file wider than the window.
    const actions = document.createElement("span");
    actions.className = "cm-diff-run-actions";
    // Which edge each arrow opens, and why one of them can be dead: the down
    // arrow grows the visible code above the bar downwards, so a bar with
    // nothing above it -- the first thing in the file -- has no place to grow
    // from. The up arrow is the same story at the end of the file.
    actions.append(
      button(this.labels.up, CHEVRONS_UP, !this.atEnd, () =>
        open(view, this.start, "bottom"),
      ),
      button(this.labels.down, CHEVRONS_DOWN, !this.atStart, () =>
        open(view, this.start, "top"),
      ),
      button(this.labels.all, UNFOLD_VERTICAL, true, () => open(view, this.start, "all")),
    );
    outer.append(actions);
    const count = document.createElement("span");
    count.className = "cm-diff-run-count";
    count.textContent = this.labels.unchanged.replace("$", String(this.lines));
    outer.append(count);
    if (this.name) {
      const name = document.createElement("span");
      name.className = "cm-diff-run-name";
      name.textContent = this.name;
      outer.append(name);
    }
    return outer;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

/**
 * The same stretch on the other side of a split, if there is one.
 *
 * Paired by index rather than by position: the two documents are different
 * lengths, so the same unchanged text starts at a different offset on each
 * side, but both sides see the same changes and therefore the same runs in the
 * same order. An index cannot drift the way a mapped offset can.
 */
function across(view: EditorView, start: number): { other: EditorView; start: number } | null {
  const siblings = mergeViewSiblings(view);
  if (!siblings) {
    return null;
  }
  const other = siblings.a === view ? siblings.b : siblings.a;
  const index = runsOf(view.state).findIndex((run) => run.from === start);
  const theirs = index < 0 ? undefined : runsOf(other.state)[index];
  return theirs ? { other, start: theirs.from } : null;
}

/** Open a run on this side, and the same text on the other side of a split. */
function open(view: EditorView, start: number, how: "top" | "bottom" | "all") {
  view.dispatch({ effects: openRun.of({ start, how }) });
  const pair = across(view, start);
  pair?.other.dispatch({ effects: openRun.of({ start: pair.start, how }) });
}

/** Open a run all the way on both sides — what the gutter's icon does. */
export function unfoldRun(view: EditorView, start: number): void {
  open(view, start, "all");
}

/** Fold a run back up on both sides. */
export function foldRun(view: EditorView, start: number): void {
  view.dispatch({ effects: closeRun.of(start) });
  const pair = across(view, start);
  pair?.other.dispatch({ effects: closeRun.of(pair.start) });
}

function decorations(state: EditorState, labels: RunLabels): DecorationSet {
  const doc = state.doc;
  const open = state.field(opened);
  const ranges = [];
  for (const run of runsOf(state)) {
    const how = open.get(run.from) ?? NOTHING;
    const first = doc.lineAt(run.from).number + how.top;
    const last = doc.lineAt(run.to).number - how.bottom;
    // A bar costs a row of its own, so one hiding three lines hides less than
    // it takes. Below the size a run has to reach to be folded at all, the
    // rest is simply shown -- which is also what stops a press of the arrow
    // from leaving a two-line sliver behind.
    if (last - first + 1 < MIN_RUN) {
      continue;
    }
    const from = doc.line(Math.max(1, Math.min(first, doc.lines))).from;
    const to = doc.line(Math.max(1, Math.min(last, doc.lines))).to;
    if (to <= from) {
      continue;
    }
    const atEnd = to >= doc.length;
    ranges.push(
      Decoration.replace({
        widget: new RunWidget(
          run.from,
          last - first + 1,
          // The last stretch in the file leads into nothing: there is no
          // change below it to be inside anything, so naming a declaration
          // there would be answering a question nobody asked.
          atEnd ? "" : leadsInto(state, run),
          from === 0,
          atEnd,
          labels,
        ),
        block: true,
      }).range(from, to),
    );
  }
  return Decoration.set(ranges, true);
}

const theme = EditorView.baseTheme({
  ".cm-diff-run": {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "1px 8px",
    fontSize: "11px",
    lineHeight: "1.6",
    color: "var(--color-fg-subtle, #888)",
    background: "var(--color-bg-elevated, rgba(127,127,127,0.08))",
    borderTop: "1px solid var(--color-border, rgba(127,127,127,0.25))",
    borderBottom: "1px solid var(--color-border, rgba(127,127,127,0.25))",
    cursor: "default",
    userSelect: "none",
  },
  ".cm-diff-run-name": {
    minWidth: 0,
    flex: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontStyle: "italic",
    opacity: 0.9,
  },
  ".cm-diff-run-actions": { display: "flex", gap: "1px", flexShrink: 0 },
  ".cm-diff-run-btn": {
    display: "flex",
    alignItems: "center",
    border: "none",
    background: "transparent",
    color: "inherit",
    cursor: "pointer",
    padding: "0 4px",
    font: "inherit",
    lineHeight: "1.4",
    borderRadius: "3px",
  },
  ".cm-diff-run-btn:hover:not(:disabled)": {
    background: "var(--color-bg, rgba(127,127,127,0.2))",
    color: "var(--color-fg, inherit)",
  },
  ".cm-diff-run-btn:disabled": { opacity: "0.3", cursor: "default" },
});

/** Our own collapsed-runs bars, in place of the library's `collapseUnchanged`. */
export function collapseRunsExtension(labels: RunLabels): Extension {
  return [
    opened,
    theme,
    StateField.define<DecorationSet>({
      create: (state) => decorations(state, labels),
      update: (_value, tr) => decorations(tr.state, labels),
      provide: (field) => EditorView.decorations.from(field),
    }),
  ];
}

/** Which runs the reader has opened, for the gutter's fold-back icons. */
export function openedRuns(state: EditorState): ReadonlyMap<number, Opened> {
  return state.field(opened, false) ?? new Map();
}
