import { describe, expect, it } from "vitest";
import { decideHtmlPreviewOpen, previewLocalPath } from "./htmlPreviewTarget";
import { leaf, splitLeaf } from "@/modules/terminal/lib/terminalLayout";

describe("decideHtmlPreviewOpen", () => {
  it("replaces an existing preview pane in the same tab", () => {
    // editor leaf split with a preview leaf beside it
    const tree = splitLeaf(leaf("ed", { kind: "editor", path: "/a.html" }), "ed", "row", "pv", {
      kind: "preview",
      url: "file:///old.html",
    });
    expect(decideHtmlPreviewOpen(tree, "ed")).toEqual({ kind: "replace", leafId: "pv" });
  });

  it("splits beside a single-pane (unsplit) editor tab", () => {
    const tree = leaf("ed", { kind: "editor", path: "/a.html" });
    expect(decideHtmlPreviewOpen(tree, "ed")).toEqual({ kind: "split", fromLeafId: "ed" });
  });

  it("opens a preview tab when the tab is split but has no preview pane", () => {
    const tree = splitLeaf(leaf("ed", { kind: "editor", path: "/a.html" }), "ed", "row", "term", {
      kind: "terminal",
    });
    expect(decideHtmlPreviewOpen(tree, "ed")).toEqual({ kind: "previewTab" });
  });
});

describe("previewLocalPath", () => {
  it("returns the path for file:// and absolute urls, null for web urls", () => {
    expect(previewLocalPath("file:///Users/me/a.html")).toBe("/Users/me/a.html");
    expect(previewLocalPath("/Users/me/a.html")).toBe("/Users/me/a.html");
    expect(previewLocalPath("http://localhost:3000")).toBeNull();
    expect(previewLocalPath("https://example.com")).toBeNull();
  });

  it("handles file:// urls with a host component", () => {
    expect(previewLocalPath("file://localhost/Users/me/a.html")).toBe("/Users/me/a.html");
  });
});
