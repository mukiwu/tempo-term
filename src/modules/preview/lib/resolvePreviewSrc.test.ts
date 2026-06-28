import { describe, expect, it } from "vitest";
import { resolvePreviewSrc } from "./resolvePreviewSrc";

// The asset URL encodes the leading slash as %2F (Tauri's handler strips the
// URL's structural leading "/" before resolving the file, so the path's own
// leading slash must survive as %2F or an absolute path is read as relative and
// 404s). Inner slashes stay literal so the iframe base resolves relative assets.
function assetUrl(path: string): string {
  const segments = path.split("/").filter((seg) => seg !== "").map(encodeURIComponent);
  return "asset://localhost/%2F" + segments.join("/");
}

describe("resolvePreviewSrc", () => {
  it("routes a file:// URL through the asset protocol", () => {
    expect(resolvePreviewSrc("file:///x/index.html")).toBe(assetUrl("/x/index.html"));
  });

  it("routes a bare absolute path through the asset protocol", () => {
    expect(resolvePreviewSrc("/Users/me/page.html")).toBe(assetUrl("/Users/me/page.html"));
  });

  it("encodes the leading slash as %2F so the asset handler finds the file", () => {
    // Tauri's asset handler does `request.uri().path()[1..]` then percent-decode;
    // a literal leading "/" gets stripped, turning /Users/... into the relative
    // Users/... -> File::open -> 404. %2F survives the strip and decodes to "/".
    const src = resolvePreviewSrc("/Users/me/site/pages/index.html");
    expect(src).toBe("asset://localhost/%2FUsers/me/site/pages/index.html");
  });

  it("keeps inner slashes literal so relative assets resolve to sibling files", () => {
    const src = resolvePreviewSrc("/Users/me/site/pages/index.html");
    // Exactly one %2F (the leading slash); directory separators stay literal so
    // the base dir is preserved, not collapsed into one encoded segment.
    expect(src.match(/%2F/g)?.length).toBe(1);
    expect(src).toContain("/site/pages/");
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
