import { describe, expect, it } from "vitest";
import { ImeDuplicateFilter } from "./imeDuplicateFilter";

describe("ImeDuplicateFilter", () => {
  it("forwards ordinary typing untouched when no composition happened", () => {
    const f = new ImeDuplicateFilter();
    expect(f.shouldForward("a", 0)).toBe(true);
    expect(f.shouldForward("a", 10)).toBe(true); // repeated 'a' is real typing
    expect(f.shouldForward("b", 20)).toBe(true);
  });

  it("forwards the first delivery of the composed text after a commit", () => {
    const f = new ImeDuplicateFilter();
    f.noteCompositionEnd("測試", 100);
    expect(f.shouldForward("測試", 105)).toBe(true);
  });

  it("drops an immediate duplicate of the just-committed text", () => {
    const f = new ImeDuplicateFilter();
    f.noteCompositionEnd("測試", 100);
    expect(f.shouldForward("測試", 105)).toBe(true);
    expect(f.shouldForward("測試", 110)).toBe(false); // the IME duplicate
  });

  it("forwards different text typed right after a commit", () => {
    const f = new ImeDuplicateFilter();
    f.noteCompositionEnd("測試", 100);
    expect(f.shouldForward("測試", 105)).toBe(true);
    expect(f.shouldForward("english", 120)).toBe(true);
  });

  it("does not drop a genuine repeat once the guard window passes", () => {
    const f = new ImeDuplicateFilter();
    f.noteCompositionEnd("測試", 100);
    expect(f.shouldForward("測試", 105)).toBe(true);
    // Same text again, but well after the guard window: a deliberate repeat.
    expect(f.shouldForward("測試", 500)).toBe(true);
  });

  it("treats each separate commit independently (legitimate repeats survive)", () => {
    const f = new ImeDuplicateFilter();
    f.noteCompositionEnd("測試", 100);
    expect(f.shouldForward("測試", 105)).toBe(true);
    // User commits the same word again as a new composition.
    f.noteCompositionEnd("測試", 300);
    expect(f.shouldForward("測試", 305)).toBe(true);
  });
});
