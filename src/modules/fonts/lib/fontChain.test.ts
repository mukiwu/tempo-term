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
  it("orders primary, then CJK fallback, then base fallbacks ending in monospace", () => {
    const chain = buildTerminalFontFamily({
      primary: "JetBrains Mono",
      cjkFallback: "Sarasa Mono TC",
    });
    const parts = chain.split(", ");
    expect(parts[0]).toBe('"JetBrains Mono"');
    expect(parts[1]).toBe('"Sarasa Mono TC"');
    expect(parts[parts.length - 1]).toBe("monospace");
  });

  it("always terminates with the generic monospace family", () => {
    const chain = buildTerminalFontFamily({});
    expect(chain.endsWith("monospace")).toBe(true);
  });

  it("skips empty primary or CJK fallback without leaving blanks", () => {
    const chain = buildTerminalFontFamily({ primary: "", cjkFallback: "  " });
    expect(chain).not.toContain('""');
    expect(chain).not.toContain(", ,");
    expect(chain.endsWith("monospace")).toBe(true);
  });

  it("does not duplicate a family that already appears in the base fallbacks", () => {
    const chain = buildTerminalFontFamily({ primary: "Menlo" });
    const occurrences = chain.split(", ").filter((p) => p === '"Menlo"' || p === "Menlo");
    expect(occurrences).toHaveLength(1);
  });

  it("keeps the CJK fallback ahead of the base fallbacks so Chinese renders", () => {
    const chain = buildTerminalFontFamily({
      primary: "JetBrains Mono",
      cjkFallback: "Noto Sans Mono CJK TC",
    });
    const parts = chain.split(", ");
    const cjkIndex = parts.indexOf('"Noto Sans Mono CJK TC"');
    const monoIndex = parts.indexOf("ui-monospace");
    expect(cjkIndex).toBeGreaterThanOrEqual(0);
    expect(cjkIndex).toBeLessThan(monoIndex);
  });
});

describe("terminalFontFamilyFor", () => {
  it("prefers the user's explicit CJK fallback over the system suggestion", () => {
    const chain = terminalFontFamilyFor(
      "JetBrains Mono",
      "Noto Sans Mono CJK TC",
      "Sarasa Mono TC",
    );
    const parts = chain.split(", ");
    // The chosen fallback sits in the priority slot (right after the primary),
    // ahead of any occurrence of the suggestion in the base safety net.
    expect(parts[1]).toBe('"Noto Sans Mono CJK TC"');
    const notoIndex = parts.indexOf('"Noto Sans Mono CJK TC"');
    const sarasaIndex = parts.indexOf('"Sarasa Mono TC"');
    expect(notoIndex).toBeLessThan(sarasaIndex);
  });

  it("uses the system suggestion when the user has not chosen a fallback", () => {
    const chain = terminalFontFamilyFor("JetBrains Mono", "", "Sarasa Mono TC");
    expect(chain).toContain('"Sarasa Mono TC"');
  });

  it("still produces a valid chain when nothing is configured or detected", () => {
    const chain = terminalFontFamilyFor("", "", null);
    expect(chain.endsWith("monospace")).toBe(true);
  });
});
