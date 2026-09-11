import { describe, expect, it } from "vitest";
import { MergeView } from "@codemirror/merge";
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
    editor.dispatch({ effects: openRun.of({ start: 0, how: "top" }) });
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
    editor.dispatch({ effects: openRun.of({ start: 0, how: "top" }) });
    expect(barredRuns(editor.state).has(0)).toBe(true);

    // Opened all the way it has no bar left, which is why the way back has to
    // move to the line it starts at.
    editor.dispatch({ effects: openRun.of({ start: 0, how: "all" }) });
    expect(barredRuns(editor.state).has(0)).toBe(false);
    expect(openedRuns(editor.state).has(0)).toBe(true);
  });
});
