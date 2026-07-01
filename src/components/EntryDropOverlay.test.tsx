import { describe, expect, it } from "vitest";
import { dropOverlayClassName, outerBandOverlayClassName } from "./EntryDropOverlay";

describe("dropOverlayClassName", () => {
  it("covers the whole pane for center", () => {
    expect(dropOverlayClassName({ kind: "center" }, true)).toContain("inset-0");
  });

  it("covers the whole pane when zone is null (no zone resolved yet)", () => {
    expect(dropOverlayClassName(null, true)).toContain("inset-0");
  });

  it("renders a top strip for an individual col/before zone", () => {
    const cls = dropOverlayClassName(
      { kind: "split", scope: "individual", direction: "col", anchor: "before" },
      true,
    );
    expect(cls).toContain("top-0");
    expect(cls).toContain("h-1/4");
  });

  it("renders a right strip for an individual row/after zone", () => {
    const cls = dropOverlayClassName(
      { kind: "split", scope: "individual", direction: "row", anchor: "after" },
      true,
    );
    expect(cls).toContain("right-0");
    expect(cls).toContain("w-1/4");
  });

  it("uses the danger color when ok is false", () => {
    expect(dropOverlayClassName({ kind: "center" }, false)).toContain("border-danger");
  });
});

describe("outerBandOverlayClassName", () => {
  it("renders a left band for row/before", () => {
    const cls = outerBandOverlayClassName("row", "before");
    expect(cls).toContain("left-0");
  });

  it("renders a bottom band for col/after", () => {
    const cls = outerBandOverlayClassName("col", "after");
    expect(cls).toContain("bottom-0");
  });
});
