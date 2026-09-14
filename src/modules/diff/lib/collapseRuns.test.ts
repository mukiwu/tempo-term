import { describe, expect, it } from "vitest";
import { getChunks, MergeView } from "@codemirror/merge";
import type { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import {
  barredRuns,
  collapseRunsExtension,
  openedRuns,
  openRun,
  runKeyAt,
  STEP,
} from "./collapseRuns";

const LABELS = {
  unchanged: "$ unchanged lines",
  up: (lines: number) => `up ${lines}`,
  down: (lines: number) => `down ${lines}`,
};

/** A document whose only change sits at line 40, leaving a stretch each side. */
function view() {
  const lines = Array.from({ length: 80 }, (_, i) => `line ${i + 1}`);
  const parent = document.createElement("div");
  document.body.append(parent);
  return new MergeView({
    a: { doc: lines.join("\n") },
    b: {
      doc: lines.map((line, i) => (i === 39 ? "changed" : line)).join("\n"),
      extensions: [collapseRunsExtension(LABELS)],
    },
    parent,
  }).b;
}

describe("runKeyAt", () => {
  it("answers with the stretch, not with where its bar happens to be drawn", () => {
    const editor = view();
    const key = runKeyAt(editor.state, 0);
    expect(key).toBe(0);

    // Opening the top edge reveals lines from the start of the stretch, so the
    // bar is redrawn twenty lines further down while the stretch keeps the key
    // it was opened under. A gutter that took its key from the bar's new
    // position would look up a stretch that does not exist -- which is what
    // left the icon beside it doing nothing at all.
    editor.dispatch({ effects: openRun.of({ start: 0, how: "top", lines: STEP }) });
    const barStart = editor.state.doc.line(1 + STEP).from;
    expect(barStart).toBeGreaterThan(0);
    expect(runKeyAt(editor.state, barStart)).toBe(0);
    expect(openedRuns(editor.state).has(0)).toBe(true);
  });

  it("has no answer for a position outside every stretch", () => {
    const editor = view();
    // The changed line itself: it is what the stretches are the gaps between.
    expect(runKeyAt(editor.state, editor.state.doc.line(40).from)).toBeNull();
  });
});

describe("barredRuns", () => {
  it("keeps a stretch while it still hides something, and drops it when it does not", () => {
    const editor = view();
    expect(barredRuns(editor.state).has(0)).toBe(true);

    // Still hiding sixteen of its thirty-six lines, so still a bar.
    editor.dispatch({ effects: openRun.of({ start: 0, how: "top", lines: STEP }) });
    expect(barredRuns(editor.state).has(0)).toBe(true);

    // Opened all the way it has no bar left, which is why the way back has to
    // move to the line it starts at.
    editor.dispatch({ effects: openRun.of({ start: 0, how: "all", lines: Number.MAX_SAFE_INTEGER }) });
    expect(barredRuns(editor.state).has(0)).toBe(false);
    expect(openedRuns(editor.state).has(0)).toBe(true);
  });
});

/** Both sides collapsing, which is how the pane actually runs. */
function pair(a: string, b: string) {
  const parent = document.createElement("div");
  document.body.append(parent);
  return new MergeView({
    a: { doc: a, extensions: [collapseRunsExtension(LABELS)] },
    b: { doc: b, extensions: [collapseRunsExtension(LABELS)] },
    parent,
  });
}

/** How many lines each bar is hiding, in order down the document. */
const hidden = (editor: EditorView) =>
  Array.from(editor.dom.querySelectorAll("[data-lines]")).map((el) =>
    Number((el as HTMLElement).dataset.lines),
  );

describe("the two sides", () => {
  it("hide the same lines when a chunk covers none of one of them", () => {
    // A pure insertion: the chunk covers lines in B and, by the library's own
    // definition, none in A -- `toA` equals `fromA`. Mapping that end with any
    // adjustment of our own put the stretch after it one line further down on
    // the side without the lines, so the two sides stopped lining up, and the
    // extra line could push a stretch under the minimum on one side only --
    // leaving the sides with different numbers of bars.
    const lines = Array.from({ length: 80 }, (_, i) => `line ${i + 1}`);
    const inserted = [...lines.slice(0, 40), "added one", "added two", ...lines.slice(40)];

    const merge = pair(lines.join('\n'), inserted.join('\n'));

    // Written out rather than only compared side to side: a margin spent
    // on both sides at once is still wrong and still equal.
    expect(hidden(merge.a)).toEqual([37, 37]);
    expect(hidden(merge.a)).toEqual(hidden(merge.b));
  });

  it("hide the same lines when the file opens with an insertion", () => {
    // The chunk is first and covers no lines on the left, so that side is
    // still on line 1 after it. Asking "are we at the top of the file?" by
    // the line number rather than by how many changes are behind us kept the
    // whole margin there and spent it on the right, which is a different
    // number of lines hidden on each side.
    const lines = Array.from({ length: 80 }, (_, i) => `line ${i + 1}`);
    // A second change, so there is a stretch *between* two chunks: that is
    // the one the question is asked about. With the insertion alone there is
    // no stretch following a chunk that sits on line 1, and the line the
    // answer is wrong about is never reached. And it has to be a difference
    // between the two documents -- the same edited line in both is no chunk
    // at all, which leaves the insertion as the only one again.
    const withHeader = [
      "added header",
      ...lines.map((line, i) => (i === 39 ? "changed" : line)),
    ];

    const merge = pair(lines.join('\n'), withHeader.join('\n'));

    // Written out rather than only compared side to side: a margin spent on
    // both sides at once is still wrong and still equal.
    expect(hidden(merge.a)).toEqual([33, 37]);
    expect(hidden(merge.a)).toEqual(hidden(merge.b));
  });

  it("hide the same lines when the chunk is a pure deletion", () => {
    // The same case from the other end: no lines in B this time.
    const lines = Array.from({ length: 80 }, (_, i) => `line ${i + 1}`);
    const shorter = [...lines.slice(0, 40), ...lines.slice(42)];

    const merge = pair(lines.join('\n'), shorter.join('\n'));

    expect(hidden(merge.a)).toEqual([37, 35]);
    expect(hidden(merge.a)).toEqual(hidden(merge.b));
  });
});

describe("the bar's arrows", () => {
  it("answer the keyboard, not just the mouse", () => {
    // They are buttons, so Enter and Space are what a reader expects -- and
    // the editor's own key handling swallows both before a click is ever
    // synthesised, so nothing arrived at a control that looks pressable.
    const editor = view();
    const down = editor.dom.querySelector<HTMLButtonElement>(
      '[aria-label^="down"]:not([disabled])',
    );
    expect(down).not.toBeNull();
    const before = barredRuns(editor.state);

    down!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(openedRuns(editor.state).size).toBe(1);
    expect(before.size).toBeGreaterThan(0);
  });
});

describe("what a press opens", () => {
  it("is the number the arrow promised, not a step that happens to match", () => {
    // The label and the act were two numbers: the label said what was left
    // when a step would strand a sliver, the effect always added a step. They
    // agreed only because MIN_RUN and STEP happen to make them agree, and
    // nothing said so -- the difference does not reach the screen, since a
    // sliver under MIN_RUN is shown rather than barred either way.
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);
    const parent = document.createElement("div");
    document.body.append(parent);
    const editor = new MergeView({
      a: { doc: lines.join('\n') },
      b: {
        doc: lines.map((line, i) => (i === 26 ? "changed" : line)).join('\n'),
        extensions: [collapseRunsExtension(LABELS)],
      },
      parent,
    }).b;

    const bar = editor.dom.querySelector<HTMLElement>("[data-lines]")!;
    const hidden = Number(bar.dataset.lines);
    expect(hidden).toBe(23);
    // The stretch is the first thing in the file, so the arrow that can grow
    // is the one reaching up from the change below it.
    const arrow = bar.querySelector<HTMLButtonElement>('[aria-label^="up"]')!;
    expect(arrow.disabled).toBe(false);
    expect(arrow.getAttribute("aria-label")).toBe(`up ${hidden}`);

    arrow.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    // The up arrow reveals the lines at the stretch's foot, so that is the
    // edge the field records.
    const [how] = [...openedRuns(editor.state).values()];
    expect(how.bottom).toBe(hidden);
  });
});

/**
 * `buildCollapsedRanges`, copied out of the library, with the margin and
 * minimum this extension uses.
 *
 * A copy rather than a call because the library's version is not exported,
 * and the point is to be told when the two answers part. If a release of
 * `@codemirror/merge` changes how it maps a chunk's end, this is what says so
 * -- loudly, rather than as two columns quietly a line out of step.
 */
function reference(state: EditorState): number[] {
  const info = getChunks(state)!;
  const chunks = info.chunks;
  const isA = info.side === "a";
  const out: number[] = [];
  let prevLine = 1;
  for (let i = 0; ; i++) {
    const chunk = i < chunks.length ? chunks[i] : null;
    const from = i ? prevLine + 3 : 1;
    const to = chunk
      ? state.doc.lineAt(isA ? chunk.fromA : chunk.fromB).number - 1 - 3
      : state.doc.lines;
    if (to - from + 1 >= 5) out.push(state.doc.line(from).from);
    if (!chunk) break;
    prevLine = state.doc.lineAt(Math.min(state.doc.length, isA ? chunk.toA : chunk.toB)).number;
  }
  return out;
}

/** Our own answer, read off the state rather than the DOM (jsdom renders only
 *  the viewport, so counting `[data-lines]` undercounts on a long file). */
const ours = (v: EditorView) => [...barredRuns(v.state)].sort((x, y) => x - y);

let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

describe("every stretch, against the library's own answer", () => {
  it("agrees on both sides of three hundred random diffs", () => {
    const bad: string[] = [];
    for (let c = 0; c < 300; c++) {
      // 40-99 lines; per line 2% delete, 2% insert-before, 2% modify;
      // then 30% chance of an insertion at the very top and 30% at the very
      // bottom. The top one is what makes chunk 0 zero-width on side A.
      const n = 40 + Math.floor(rnd() * 60);
      const a = Array.from({ length: n }, (_, i) => `line ${i + 1}`);
      const b: string[] = [];
      for (let i = 0; i < n; i++) {
        const r = rnd();
        if (r < 0.02) continue;
        if (r < 0.04) { b.push("ins A"); b.push(a[i]); continue; }
        if (r < 0.06) { b.push("mod"); continue; }
        b.push(a[i]);
      }
      if (rnd() < 0.3) b.unshift("top ins");
      if (rnd() < 0.3) b.push("bottom ins");

      const parent = document.createElement("div");
      document.body.append(parent);
      const m = new MergeView({
        a: { doc: a.join("\n"), extensions: [collapseRunsExtension(LABELS)] },
        b: { doc: b.join("\n"), extensions: [collapseRunsExtension(LABELS)] },
        parent,
      });
      const j = JSON.stringify;
      const ao = ours(m.a), ar = reference(m.a.state);
      const bo = ours(m.b), br = reference(m.b.state);
      if (j(ao) !== j(ar) || j(bo) !== j(br)) {
        bad.push(j({ c, ao, ar, bo, br }));
      } else if (ao.length !== bo.length) {
        bad.push("COUNTDIFF " + j({ c, ao, bo }));
      }
      m.destroy();
      parent.remove();
    }
    expect(bad.slice(0, 3)).toEqual([]);
  });
});
