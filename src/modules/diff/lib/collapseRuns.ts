import { getChunks, mergeViewSiblings } from "@codemirror/merge";
import { StateEffect, StateField, type EditorState, type Extension } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import {
  ARROW_DOWN_FROM_LINE,
  ARROW_UP_FROM_LINE,
  lucideIcon,
  type IconStroke,
} from "./lucideDom";
import { refreshGutterHint, withGutterHint } from "./gutterHint";

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
  /**
   * What the arrows promise, given the number of lines the press will
   * actually reveal. Functions rather than finished sentences because that
   * number is not always the step: the last few lines of a run come with it.
   */
  up: (lines: number) => string;
  down: (lines: number) => string;
}

/**
 * Open part of a run, or all of it. `start` is the run's first line.
 *
 * `lines` is how many the press opens, carried rather than worked out again
 * here: the arrow's label promises a number, and the promise and the act have
 * to be the same one. They used to be two -- the label said what was left when
 * a step would strand a sliver, the effect always added a step -- and agreed
 * only because `MIN_RUN` and `STEP` happen to make them agree.
 */
export const openRun = StateEffect.define<{
  start: number;
  how: "top" | "bottom" | "all";
  lines: number;
}>();

/** Fold one run back up. */
export const closeRun = StateEffect.define<number>();


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
    // Mapped before the effects rather than after them, and without asking
    // whether an effect arrived. The documents are read-only, so this only
    // happens when a surface reconfigures -- but a transaction that both
    // moved the text and opened a stretch used to skip the mapping entirely
    // and leave every key pointing at where the text was.
    if (tr.docChanged && next.size > 0) {
      const moved = new Map<number, Opened>();
      for (const [pos, how] of next) {
        moved.set(tr.changes.mapPos(pos), how);
      }
      next = moved;
    }
    for (const effect of tr.effects) {
      if (effect.is(closeRun)) {
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
              ? { ...was, top: was.top + effect.value.lines }
              : { ...was, bottom: was.bottom + effect.value.lines },
        );
        next = map;
      }
    }
    return next;
  },
});

interface Run {
  /**
   * How many changes are above this stretch, which is what pairs it with the
   * same text on the other side of a split. The two documents are different
   * lengths, so an offset will not do it; the position in the list will not
   * either, since a stretch too short to be worth a bar is dropped, and a
   * stretch can fall under that on one side alone.
   */
  after: number;
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
  const add = (
    after: number,
    firstLine: number,
    lastLine: number,
    atStart: boolean,
    atEnd: boolean,
  ) => {
    const first = Math.max(1, firstLine + (atStart ? 0 : MARGIN));
    const last = Math.min(doc.lines, lastLine - (atEnd ? 0 : MARGIN));
    if (last - first + 1 < MIN_RUN) {
      return;
    }
    out.push({
      after,
      from: doc.line(first).from,
      to: doc.line(last).to,
      lines: last - first + 1,
    });
  };
  let nextFirst = 1;
  let seen = 0;
  for (const chunk of info.chunks) {
    const from = info.side === "a" ? chunk.fromA : chunk.fromB;
    const to = info.side === "a" ? chunk.toA : chunk.toB;
    const changeFirst = doc.lineAt(Math.min(from, doc.length)).number;
    // Whether this is the stretch the file opens with, asked by how many
    // changes are behind us rather than by what line we are on -- the library
    // asks it the same way (`i ? prevLine + margin : 1`). A file that opens
    // with a pure insertion has a chunk covering no lines on the other side,
    // so that side is still on line 1 after it and would keep the whole
    // margin its neighbour had already spent.
    add(seen, nextFirst, changeFirst - 1, seen === 0, false);
    // Where the stretch after this chunk starts, mapped exactly the way the
    // library maps it (`buildCollapsedRanges`, on `chunk.to` with no
    // adjustment either way). The two sides have to land on the same line or
    // they stop lining up, and a chunk that covers no lines on this side --
    // every pure insertion, every pure deletion, where `to` equals `from` by
    // the library's own definition -- is where any adjustment of ours would
    // differ from any adjustment on the other side.
    nextFirst = doc.lineAt(Math.min(to, doc.length)).number;
    seen += 1;
  }
  add(seen, nextFirst, doc.lines, info.chunks.length === 0, true);
  return out;
}

/**
 * The declaration each of `lines` sits inside — git's own heuristic: the
 * nearest line at or above it that starts in the first column with a letter,
 * `_` or `$`.
 *
 * Read from below each bar rather than above it. What a reader wants off a bar
 * is where it is about to land, which is the same thing git puts after the
 * `@@` of the hunk that follows: "the changes below are inside this".
 *
 * Answered for every bar in one pass down the document rather than by walking
 * up from each one. Walking up costs bars × lines, and in a file where no line
 * starts in the first column — everything indented, which whole languages are
 * — every bar walks to line 1: 500 bars in a 20k-line file measured at 776ms
 * for a single transaction that changed nothing.
 *
 * `lines` must be in ascending order, which the bars are, being built down the
 * document.
 */
function declarationsAt(state: EditorState, lines: readonly number[]): string[] {
  const found: string[] = lines.map(() => "");
  if (lines.length === 0) {
    return found;
  }
  let seen = "";
  let next = 0;
  let n = 0;
  for (const text of state.doc.iterLines(1, lines[lines.length - 1] + 1)) {
    n += 1;
    if (/^[A-Za-z_$]/.test(text)) {
      // `trimEnd` after the cut as well as before it: dropping the brace off
      // `fn f() -> T {` leaves behind the space that was in front of it.
      seen = text.trim().replace(/[{(:]\s*$/, "").trimEnd();
    }
    while (next < lines.length && lines[next] === n) {
      found[next] = seen;
      next += 1;
    }
  }
  return found;
}

/**
 * One of the bar's arrows.
 *
 * The label and whether it acts are read when they are needed rather than
 * baked in, because the element outlives its answers: pressing an arrow leaves
 * the bar hiding fewer lines, and the DOM is updated in place so the button
 * that was just pressed keeps the focus a keyboard reader put on it.
 */
function button(
  paths: readonly IconStroke[],
  label: () => string,
  act: () => void,
): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "cm-diff-run-btn";
  el.append(lucideIcon(paths, 12));
  const fire = (event: Event) => {
    // The editor would otherwise take the click as a click on the text.
    event.preventDefault();
    event.stopPropagation();
    if (!el.disabled) {
      act();
    }
  };
  el.addEventListener("mousedown", fire);
  // A real button, so Enter and Space are what a reader expects to press --
  // but the editor's own key handling swallows them before a click event is
  // ever synthesised, so the bar has to listen for the keys itself.
  el.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      fire(event);
      // A press from the keyboard leaves the pointer where it was, so nothing
      // dismisses the hint the way a click does, and the button now promises
      // something else.
      refreshGutterHint(el);
    }
  });
  // The app's own hover hint rather than `title`, which the macOS WebView is
  // unreliable about and which a split diff's overflow would clip -- the same
  // reason the fold gutter next door uses it. A dead arrow gets none: a
  // control that will not act should not describe an act.
  return withGutterHint(el, () => (el.disabled ? "" : label()));
}

/** The bar each element is currently showing, for handlers that outlive one
 * version of it. */
const live = new WeakMap<HTMLElement, RunWidget>();

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
    /** What this bar will come to once it is drawn; see `barHeight`. */
    private readonly height: number,
  ) {
    super();
  }

  /**
   * CodeMirror's own answer for a widget that does not give one is a single
   * line of code, and a bar is three or four pixels over that. A lock file's
   * few hundred of them leave the document measurably shorter than it turns
   * out to be, so the scrollbar resizes under the reader as each one is
   * reached and `lineBlockAt` aims a scroll at the wrong place until it is.
   *
   * Not measured off a drawn bar: a wrong measurement poisons the height map
   * for every bar the viewport has not reached, which is worse than the
   * estimate it replaces.
   */
  get estimatedHeight(): number {
    return this.height;
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

  /**
   * What one press opens, which is the step until the tail is too short to
   * leave behind: a run of twenty-three opens whole rather than hiding three
   * lines behind a bar that takes a row to say so. The label says this number
   * because the reader can count the lines that appear.
   */
  get step(): number {
    return this.lines - STEP < MIN_RUN ? this.lines : STEP;
  }

  toDOM(view: EditorView): HTMLElement {
    const outer = document.createElement("div");
    outer.className = "cm-diff-run";
    // Everything left-aligned and in one run of content. A block widget is as
    // wide as the document, not as the pane, so anything pushed to its right
    // edge sits off the side of any file wider than the window.
    const actions = document.createElement("span");
    actions.className = "cm-diff-run-actions";
    // Two arrows, and opening the lot is the gutter's icon beside them rather
    // than a third button here: one control, one place.
    //
    // Which edge each arrow opens, and why one of them can be dead: the down
    // arrow grows the visible code above the bar downwards, so a bar with
    // nothing above it -- the first thing in the file -- has no place to grow
    // from. The up arrow is the same story at the end of the file.
    //
    // Each reads the bar as it is now rather than as it was when the element
    // was made: pressing one leaves fewer lines hidden, and the same element
    // stays on screen so that the press can be repeated without tabbing back
    // to it.
    // Never absent: `paint` writes it before this element reaches the
    // document, and again on every update that keeps the element.
    const now = () => live.get(outer)!;
    actions.append(
      button(
        ARROW_UP_FROM_LINE,
        () => now().labels.up(now().step),
        () => open(view, now().start, "bottom", now().step),
      ),
      button(
        ARROW_DOWN_FROM_LINE,
        () => now().labels.down(now().step),
        () => open(view, now().start, "top", now().step),
      ),
    );
    outer.append(actions);
    const count = document.createElement("span");
    count.className = "cm-diff-run-count";
    outer.append(count);
    this.paint(outer);
    return outer;
  }

  /**
   * Rewrite the bar in place instead of letting it be rebuilt.
   *
   * A press changes how many lines the bar hides, which makes it a different
   * widget -- and a rebuilt element is a new element, so the button a keyboard
   * reader had just pressed no longer exists and the focus falls back to the
   * editor. One press per visit to the bar is not a control.
   */
  updateDOM(dom: HTMLElement, _view: EditorView, from: RunWidget): boolean {
    // Only for the same stretch. CodeMirror looks for an element to reuse by
    // widget type alone, with no regard for where either one sits, so it will
    // offer another stretch's bar -- and accepting moves that element here,
    // which is exactly the focus loss this method exists to stop. Asked
    // before anything is written, since a refusal has to leave the element as
    // it was.
    if (from.start !== this.start) {
      return false;
    }
    this.paint(dom);
    return true;
  }

  /** The parts of the bar that say what it is hiding and what it will do. */
  private paint(outer: HTMLElement): void {
    live.set(outer, this);
    // The number as data as well as words: the words are localized, and both
    // styling and tests want the number without parsing a sentence.
    outer.dataset.lines = String(this.lines);
    const [up, down] = outer.querySelectorAll("button");
    up.disabled = this.atEnd;
    up.setAttribute("aria-label", this.labels.up(this.step));
    down.disabled = this.atStart;
    down.setAttribute("aria-label", this.labels.down(this.step));
    const count = outer.querySelector(".cm-diff-run-count")!;
    count.textContent = this.labels.unchanged.replace("$", String(this.lines));
    let name = outer.querySelector(".cm-diff-run-name");
    if (!this.name) {
      name?.remove();
      return;
    }
    if (!name) {
      name = document.createElement("span");
      name.className = "cm-diff-run-name";
      outer.append(name);
    }
    name.textContent = this.name;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

/**
 * The same stretch on the other side of a split, if there is one.
 *
 * Paired by how many changes sit above it rather than by position: the two
 * documents are different lengths, so the same unchanged text starts at a
 * different offset on each side. Not by place in the list either -- a stretch
 * too short to be worth a bar is left out, and a stretch can fall under that
 * on one side alone, which would shift every pairing after it without a word.
 */
function across(view: EditorView, start: number): { other: EditorView; start: number } | null {
  const siblings = mergeViewSiblings(view);
  if (!siblings) {
    return null;
  }
  const other = siblings.a === view ? siblings.b : siblings.a;
  const mine = runsOf(view.state).find((run) => run.from === start);
  const theirs =
    mine && runsOf(other.state).find((run) => run.after === mine.after);
  return theirs ? { other, start: theirs.from } : null;
}

/** Open a run on this side, and the same text on the other side of a split. */
function open(view: EditorView, start: number, how: "top" | "bottom" | "all", lines: number) {
  view.dispatch({ effects: openRun.of({ start, how, lines }) });
  const pair = across(view, start);
  pair?.other.dispatch({ effects: openRun.of({ start: pair.start, how, lines }) });
}

/** Open a run all the way on both sides — what the gutter's icon does. */
export function unfoldRun(view: EditorView, start: number): void {
  open(view, start, "all", Number.MAX_SAFE_INTEGER);
}

/** Fold a run back up on both sides. */
export function foldRun(view: EditorView, start: number): void {
  view.dispatch({ effects: closeRun.of(start) });
  const pair = across(view, start);
  pair?.other.dispatch({ effects: closeRun.of(pair.start) });
}

/**
 * What a bar comes to, from the same font size the pane sizes the editor with.
 *
 * The bar's own type is 0.85em at a line height of 1.6, and it carries a row
 * of padding and a border top and bottom. Derived rather than written down for
 * the reason the CSS is relative: the size follows the reader's diff font
 * setting, and the pane rebuilds this extension whenever that changes.
 */
export function barHeight(fontSize: number): number {
  return Math.round(fontSize * 0.85 * 1.6) + 4;
}

function decorations(
  state: EditorState,
  labels: RunLabels,
  height: number,
): DecorationSet {
  const doc = state.doc;
  const open = state.field(opened);
  const bars: { start: number; from: number; to: number; lines: number; atEnd: boolean }[] = [];
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
    bars.push({ start: run.from, from, to, lines: last - first + 1, atEnd: to >= doc.length });
  }
  // Named off each bar's own last line rather than the stretch's, since
  // opening the bottom of one moves where it lands: a bar that used to lead
  // into a function now leads into whatever the newly shown lines sit inside.
  const names = declarationsAt(
    state,
    bars.map((bar) => Math.min(doc.lineAt(bar.to).number + 1, doc.lines)),
  );
  return Decoration.set(
    bars.map((bar, i) =>
      Decoration.replace({
        widget: new RunWidget(
          bar.start,
          bar.lines,
          // The last stretch in the file leads into nothing: there is no
          // change below it to be inside anything, so naming a declaration
          // there would be answering a question nobody asked.
          bar.atEnd ? "" : names[i],
          bar.from === 0,
          bar.atEnd,
          labels,
          height,
        ),
        block: true,
      }).range(bar.from, bar.to),
    ),
    true,
  );
}

const theme = EditorView.baseTheme({
  ".cm-diff-run": {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "1px 8px",
    // Relative, not a fixed 11px: the editor's own size comes from the app's
    // diff font setting, and the library's bar inherited it. A number written
    // here would ignore that setting -- and stay tiny next to 18px code.
    fontSize: "0.85em",
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
  // The icons are built at a fixed pixel size, so they are sized here in the
  // bar's own em to follow the text they sit beside.
  ".cm-diff-run-btn svg": { width: "1.1em", height: "1.1em" },
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
  // The same hover the fold gutter next door wears (`.cm-diff-fold:hover` in
  // index.css): the accent colour, not a filled background. Two controls a
  // few pixels apart doing the same job should light up the same way.
  ".cm-diff-run-btn:hover:not(:disabled)": {
    color: "var(--color-accent, inherit)",
  },
  ".cm-diff-run-btn:disabled": { opacity: "0.3", cursor: "default" },
});

/** Our own collapsed-runs bars, in place of the library's `collapseUnchanged`. */
export function collapseRunsExtension(labels: RunLabels, fontSize: number): Extension {
  return [
    opened,
    theme,
    StateField.define<DecorationSet>({
      create: (state) => decorations(state, labels, barHeight(fontSize)),
      update: (value, tr) => {
        // Only when something the bars are built from has moved. A transaction
        // is dispatched for a click, a focus, a selection -- none of which
        // changes a single bar, and all of which were rebuilding every one of
        // them along with a scan of the document behind each name.
        const before = tr.startState;
        const after = tr.state;
        const same =
          !tr.docChanged &&
          before.field(opened, false) === after.field(opened, false) &&
          getChunks(before)?.chunks === getChunks(after)?.chunks;
        return same ? value : decorations(after, labels, barHeight(fontSize));
      },
      provide: (field) => EditorView.decorations.from(field),
    }),
  ];
}

/** Which runs the reader has opened, for the gutter's fold-back icons. */
export function openedRuns(state: EditorState): ReadonlyMap<number, Opened> {
  return state.field(opened, false) ?? new Map();
}

/**
 * The stretch a position belongs to, by the position that stretch is keyed on.
 *
 * The gutter knows where a bar is drawn, which is not where its stretch
 * starts: opening the top edge moves the bar down while the stretch keeps the
 * key it was opened under. Asking by containment gets the same answer either
 * way.
 */
export function runKeyAt(state: EditorState, pos: number): number | null {
  for (const run of runsOf(state)) {
    if (pos >= run.from && pos <= run.to) {
      return run.from;
    }
  }
  return null;
}

/** Stretches that still hide something, so still have a bar of their own. */
export function barredRuns(state: EditorState): ReadonlySet<number> {
  const doc = state.doc;
  const open = openedRuns(state);
  const out = new Set<number>();
  for (const run of runsOf(state)) {
    const how = open.get(run.from) ?? NOTHING;
    const first = doc.lineAt(run.from).number + how.top;
    const last = doc.lineAt(run.to).number - how.bottom;
    if (last - first + 1 >= MIN_RUN) {
      out.add(run.from);
    }
  }
  return out;
}
