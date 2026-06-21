import { describe, expect, it } from "vitest";
import { resolvePreviewSrc } from "./resolvePreviewSrc";

// The asset URL keeps directory structure (slashes literal, segments encoded)
// so the iframe's base resolves the page's relative CSS/JS/images.
function assetUrl(path: string): string {
  return "asset://localhost" + path.split("/").map(encodeURIComponent).join("/");
}

describe("resolvePreviewSrc", () => {
  it("routes a file:// URL through the asset protocol", () => {
    expect(resolvePreviewSrc("file:///x/index.html")).toBe(assetUrl("/x/index.html"));
  });

  it("routes a bare absolute path through the asset protocol", () => {
    expect(resolvePreviewSrc("/Users/me/page.html")).toBe(assetUrl("/Users/me/page.html"));
  });

  it("keeps directory structure so relative assets resolve", () => {
    const src = resolvePreviewSrc("/Users/me/site/pages/index.html");
    // Slashes stay literal — the base dir is preserved, not collapsed into one
    // encoded segment.
    expect(src).toBe("asset://localhost/Users/me/site/pages/index.html");
    expect(src).not.toContain("%2F");
  });

  it("leaves real web URLs untouched", () => {
    expect(resolvePreviewSrc("https://example.com/a")).toBe("https://example.com/a");
    expect(resolvePreviewSrc("http://localhost:3000")).toBe("http://localhost:3000");
  });

  it("leaves an already-converted asset URL untouched", () => {
    expect(resolvePreviewSrc("asset://localhost/x")).toBe("asset://localhost/x");
  });

  it("encodes (not collapses) non-ASCII directory segments in a file:// path", () => {
    const path = "/Users/muki/新點新網資料/style-g.html";
    expect(resolvePreviewSrc(`file://${path}`)).toBe(assetUrl(path));
  });

  it("returns empty string for blank input", () => {
    expect(resolvePreviewSrc("   ")).toBe("");
  });
});
