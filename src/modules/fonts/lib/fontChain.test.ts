import { describe, expect, it } from "vitest";
import {
  buildTerminalFontFamily,
  quoteFamily,
  terminalFontFamilyFor,
} from "./fontChain";

describe("quoteFamily", () => {
  it("wraps multi-word family names in quotes", () => {
    expect(quoteFamily("Sarasa Mono TC")).toBe('"Sarasa Mono TC"');
  });

  it("leaves generic keywords and single-token names unquoted", () => {
    expect(quoteFamily("monospace")).toBe("monospace");
    expect(quoteFamily("ui-monospace")).toBe("ui-monospace");
    expect(quoteFamily("SFMono-Regular")).toBe("SFMono-Regular");
  });
});

describe("buildTerminalFontFamily", () => {
  it("puts the primary font first and ends with generic monospace", () => {
    const parts = buildTerminalFontFamily({ primary: "JetBrains Mono" }).split(", ");
    expect(parts[0]).toBe('"JetBrains Mono"');
    expect(parts[parts.length - 1]).toBe("monospace");
  });

  it("always terminates with the generic monospace family", () => {
    expect(buildTerminalFontFamily({}).endsWith("monospace")).toBe(true);
  });

  it("skips empty primary or CJK fallback without leaving blanks", () => {
    const chain = buildTerminalFontFamily({ primary: "", cjkFallback: "  " });
    expect(chain).not.toContain('""');
    expect(chain).not.toContain(", ,");
    expect(chain.endsWith("monospace")).toBe(true);
  });

  it("does not duplicate a family that already appears in the anchors", () => {
    const chain = buildTerminalFontFamily({ primary: "Menlo" });
    const occurrences = chain.split(", ").filter((p) => p === '"Menlo"' || p === "Menlo");
    expect(occurrences).toHaveLength(1);
  });

  it("keeps a Latin monospace anchor BEFORE the CJK fallback so ASCII stays fixed-width", () => {
    const parts = buildTerminalFontFamily({
      primary: "JetBrains Mono",
      cjkFallback: "PingFang TC",
    }).split(", ");
    const anchorIndex = parts.indexOf("ui-monospace");
    const cjkIndex = parts.indexOf('"PingFang TC"');
    expect(anchorIndex).toBeGreaterThanOrEqual(0);
    expect(cjkIndex).toBeGreaterThan(anchorIndex);
  });

  it("places the CJK fallback before the generic monospace keyword", () => {
    const parts = buildTerminalFontFamily({ cjkFallback: "Noto Sans Mono CJK TC" }).split(", ");
    const cjkIndex = parts.indexOf('"Noto Sans Mono CJK TC"');
    const genericIndex = parts.indexOf("monospace");
    expect(cjkIndex).toBeGreaterThanOrEqual(0);
    expect(cjkIndex).toBeLessThan(genericIndex);
  });
});

describe("terminalFontFamilyFor", () => {
  it("prefers the user's explicit CJK fallback over the system suggestion", () => {
    const parts = terminalFontFamilyFor(
      "JetBrains Mono",
      "Noto Sans Mono CJK TC",
      "Sarasa Mono TC",
    ).split(", ");
    const notoIndex = parts.indexOf('"Noto Sans Mono CJK TC"');
    const sarasaIndex = parts.indexOf('"Sarasa Mono TC"');
    // The chosen fallback sits ahead of the suggestion in the safety net.
    expect(notoIndex).toBeGreaterThanOrEqual(0);
    expect(notoIndex).toBeLessThan(sarasaIndex);
  });

  it("uses the system suggestion when the user has not chosen a fallback", () => {
    expect(terminalFontFamilyFor("JetBrains Mono", "", "Sarasa Mono TC")).toContain(
      '"Sarasa Mono TC"',
    );
  });

  it("still produces a valid chain when nothing is configured or detected", () => {
    expect(terminalFontFamilyFor("", "", null).endsWith("monospace")).toBe(true);
  });

  it("keeps ASCII on a monospace anchor even when only a proportional CJK font is detected", () => {
    const parts = terminalFontFamilyFor("", "", "PingFang TC").split(", ");
    // No primary, so the first family must be a Latin monospace anchor, not PingFang.
    expect(parts[0]).toBe("ui-monospace");
    expect(parts.indexOf("ui-monospace")).toBeLessThan(parts.indexOf('"PingFang TC"'));
  });
});
