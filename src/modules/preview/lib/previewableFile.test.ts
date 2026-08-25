import { describe, it, expect } from "vitest";
import { isBrowserPreviewable } from "./previewableFile";

describe("isBrowserPreviewable", () => {
  it("accepts pages, images and media the WebView renders itself", () => {
    expect(isBrowserPreviewable("/p/index.html")).toBe(true);
    expect(isBrowserPreviewable("/p/page.htm")).toBe(true);
    expect(isBrowserPreviewable("/p/logo.svg")).toBe(true);
    expect(isBrowserPreviewable("/p/spec.pdf")).toBe(true);
    expect(isBrowserPreviewable("/p/avatar.jpg")).toBe(true);
    expect(isBrowserPreviewable("/p/clip.mp4")).toBe(true);
  });

  it("rejects source files and other things the WebView cannot render", () => {
    expect(isBrowserPreviewable("/p/main.ts")).toBe(false);
    expect(isBrowserPreviewable("/p/lib.rs")).toBe(false);
    expect(isBrowserPreviewable("/p/notes.md")).toBe(false);
    expect(isBrowserPreviewable("/p/archive.zip")).toBe(false);
  });

  it("is case-insensitive on the extension", () => {
    expect(isBrowserPreviewable("/p/INDEX.HTML")).toBe(true);
    expect(isBrowserPreviewable("/p/Photo.JPEG")).toBe(true);
  });

  it("treats a dotfile's leading dot as a name, not an extension", () => {
    // `.html` as a whole filename is a config-ish dotfile, not an HTML page.
    expect(isBrowserPreviewable("/p/.html")).toBe(false);
    expect(isBrowserPreviewable("/p/.env")).toBe(false);
    expect(isBrowserPreviewable("/p/Makefile")).toBe(false);
  });

  it("only looks at the last segment, so a directory named *.html does not leak in", () => {
    expect(isBrowserPreviewable("/p/site.html/main.ts")).toBe(false);
    expect(isBrowserPreviewable("C:\\p\\index.html")).toBe(true);
  });
});
