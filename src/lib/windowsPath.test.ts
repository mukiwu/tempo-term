import { describe, expect, it } from "vitest";
import { normalizeWindowsDrivePath } from "./windowsPath";

describe("normalizeWindowsDrivePath", () => {
  it("converts a native drive path to forward slashes", () => {
    expect(normalizeWindowsDrivePath("C:\\Users\\me\\site\\index.html")).toBe(
      "C:/Users/me/site/index.html",
    );
  });

  it("removes the leading slash from a file URL drive path", () => {
    expect(normalizeWindowsDrivePath("/C:/Users/me/site/index.html")).toBe(
      "C:/Users/me/site/index.html",
    );
  });

  it("returns null for paths without an absolute drive letter", () => {
    expect(normalizeWindowsDrivePath("relative\\file.html")).toBeNull();
    expect(normalizeWindowsDrivePath("/Users/me/file.html")).toBeNull();
  });
});
