import { describe, expect, it } from "vitest";
import { extOf, fileOpenContent, isImagePath, isPdfPath } from "./fileOpenContent";

describe("extOf", () => {
  it("lowercases and strips the dot", () => {
    expect(extOf("/a/Logo.PNG")).toBe("png");
  });

  it("returns empty for extensionless and dotfiles", () => {
    expect(extOf("/a/README")).toBe("");
    expect(extOf("/a/.env")).toBe("");
  });

  it("handles Windows separators", () => {
    expect(extOf("C:\\pics\\shot.Jpg")).toBe("jpg");
  });
});

describe("fileOpenContent", () => {
  it("routes image extensions to the media viewer", () => {
    for (const file of ["/a/x.png", "/a/x.JPEG", "/a/x.gif", "/a/x.webp", "/a/x.svg", "/a/x.ico"]) {
      expect(fileOpenContent(file)).toEqual({ kind: "media", path: file });
      expect(isImagePath(file)).toBe(true);
    }
  });

  it("routes PDFs to the native preview with a file:// url", () => {
    expect(fileOpenContent("/a/doc.pdf")).toEqual({ kind: "preview", url: "file:///a/doc.pdf" });
    expect(isPdfPath("/a/DOC.PDF")).toBe(true);
  });

  it("routes everything else to the editor", () => {
    expect(fileOpenContent("/a/main.ts")).toEqual({ kind: "editor", path: "/a/main.ts" });
    expect(fileOpenContent("/a/README")).toEqual({ kind: "editor", path: "/a/README" });
  });

  it("never remaps remote ssh:// paths", () => {
    expect(fileOpenContent("ssh://c1/pics/a.png")).toEqual({
      kind: "editor",
      path: "ssh://c1/pics/a.png",
    });
  });
});
