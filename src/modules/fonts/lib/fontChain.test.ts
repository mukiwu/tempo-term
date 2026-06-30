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

  it("places the icon fallback after the Latin anchors and before the CJK fallback", () => {
    // Order matters: the Latin anchors must come BEFORE the icon font so that
    // when primary is empty (system default), ASCII still renders in Menlo /
    // ui-monospace instead of being hijacked by the Nerd Font's Latin glyphs.
    // The icon font only kicks in for PUA codepoints that the anchors lack.
    const parts = buildTerminalFontFamily({
      primary: "JetBrains Mono",
      iconFallback: "FiraCode Nerd Font Mono",
      cjkFallback: "PingFang TC",
    }).split(", ");
    const primaryIndex = parts.indexOf('"JetBrains Mono"');
    const anchorIndex = parts.indexOf("ui-monospace");
    const iconIndex = parts.indexOf('"FiraCode Nerd Font Mono"');
    const cjkIndex = parts.indexOf('"PingFang TC"');
    expect(primaryIndex).toBe(0);
    expect(primaryIndex).toBeLessThan(anchorIndex);
    expect(anchorIndex).toBeLessThan(iconIndex);
    expect(iconIndex).toBeLessThan(cjkIndex);
  });

  it("omits the icon fallback slot cleanly when not provided", () => {
    const parts = buildTerminalFontFamily({ primary: "JetBrains Mono" }).split(", ");
    expect(parts[0]).toBe('"JetBrains Mono"');
    expect(parts[1]).toBe("ui-monospace");
    expect(parts.some((p) => p.toLowerCase().includes("nerd"))).toBe(false);
  });

  it("keeps ASCII on the Latin anchor when only icon font is set and primary is empty", () => {
    // Regression guard for spec #2: setting an icon font must NOT cause Latin
    // text to be rendered by the Nerd Font when the user has no primary set.
    const parts = buildTerminalFontFamily({
      iconFallback: "FiraCode Nerd Font Mono",
    }).split(", ");
    expect(parts[0]).toBe("ui-monospace");
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
  it("threads the user's icon fallback into the chain after the Latin anchors", () => {
    const parts = terminalFontFamilyFor(
      "JetBrains Mono",
      "",
      null,
      "FiraCode Nerd Font Mono",
      null,
    ).split(", ");
    const anchorIndex = parts.indexOf("ui-monospace");
    const iconIndex = parts.indexOf('"FiraCode Nerd Font Mono"');
    expect(parts[0]).toBe('"JetBrains Mono"');
    expect(anchorIndex).toBeGreaterThan(0);
    expect(iconIndex).toBeGreaterThan(anchorIndex);
  });

  it("prefers the user's explicit icon fallback over the system suggestion", () => {
    const chain = terminalFontFamilyFor(
      "JetBrains Mono",
      "",
      null,
      "Hack Nerd Font Mono",
      "MesloLGS NF",
    );
    expect(chain).toContain('"Hack Nerd Font Mono"');
    expect(chain).not.toContain("MesloLGS NF");
  });

  it("uses the suggested icon fallback when the user has not chosen one", () => {
    const chain = terminalFontFamilyFor("JetBrains Mono", "", null, "", "MesloLGS NF");
    expect(chain).toContain("MesloLGS NF");
  });

  it("does not insert any icon fallback when neither user choice nor suggestion exist", () => {
    const chain = terminalFontFamilyFor("JetBrains Mono", "", null, "", null);
    expect(chain.toLowerCase()).not.toContain("nerd");
    expect(chain.toLowerCase()).not.toContain("meslo");
  });

  it("the 'none' sentinel disables icon fallback even when a suggestion is detected", () => {
    const enabled = terminalFontFamilyFor("JetBrains Mono", "", null, "", "MesloLGS NF");
    const disabled = terminalFontFamilyFor("JetBrains Mono", "", null, "none", "MesloLGS NF");
    expect(enabled).toContain("MesloLGS NF");
    expect(disabled).not.toContain("MesloLGS NF");
    // 'none' is a sentinel, not a real family — it must never land in the chain.
    const parts = disabled.split(", ");
    expect(parts).not.toContain("none");
    expect(parts).not.toContain('"none"');
  });

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
