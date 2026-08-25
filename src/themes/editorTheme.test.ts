import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { editorSyntaxTheme } from "./editorTheme";
import { DEFAULT_THEME_ID, THEMES } from "./themes";

describe("editorSyntaxTheme", () => {
  it("gives github-dark a different editor theme from vitesse-dark", () => {
    expect(editorSyntaxTheme("github-dark")).not.toBe(editorSyntaxTheme("vitesse-dark"));
  });

  it("maps every registered theme to its own distinct editor theme", () => {
    const themes = THEMES.map((th) => editorSyntaxTheme(th.id));
    expect(new Set(themes).size).toBe(THEMES.length);
  });

  it("falls back to the default theme's editor for an unknown id", () => {
    expect(editorSyntaxTheme("does-not-exist")).toBe(editorSyntaxTheme(DEFAULT_THEME_ID));
  });
});

describe("gutter wallpaper", () => {
  function gutterRules() {
    const view = new EditorView({ doc: "x", extensions: [editorSyntaxTheme(DEFAULT_THEME_ID)] });
    try {
      return [...document.querySelectorAll("style")]
        .flatMap((style) => [...(style.sheet?.cssRules ?? [])])
        .filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule)
        .filter((rule) => rule.selectorText.endsWith(".cm-gutters"));
    } finally {
      view.destroy();
    }
  }

  it("pins the gutter's copy of the wallpaper to the viewport", () => {
    const painted = gutterRules().filter(
      (rule) => rule.style.getPropertyValue("background-image") !== "",
    );

    expect(painted).toHaveLength(1);
    const style = painted[0].style;
    expect(style.getPropertyValue("background-image")).toBe("var(--cm-gutter-bg-image, none)");
    // Pinned to the viewport, so scrolling the gutter never moves the image —
    // that is what keeps it from lagging the way anything JS-driven would.
    expect(style.getPropertyValue("background-attachment")).toBe("scroll, fixed");
    expect(style.getPropertyValue("background-size")).toContain("--wallpaper-fixed-size");
    expect(style.getPropertyValue("background-position")).toContain("--wallpaper-fixed-pos");
  });

  it("adds no colour of its own, so an unset wallpaper leaves the gutter alone", () => {
    // The wallpaper layer is an image, never a colour: without a background
    // image --cm-gutter-bg-image is undefined, the whole declaration drops out,
    // and the gutter keeps whatever --color-editor-gutter-bg gave it.
    const painted = gutterRules().filter(
      (rule) => rule.style.getPropertyValue("background-image") !== "",
    );

    expect(painted[0].style.getPropertyValue("background-color")).toBe("");
  });
});
