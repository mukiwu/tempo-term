import { describe, expect, it } from "vitest";
import { parseDiffLines } from "./parseDiff";

describe("parseDiffLines", () => {
  it("returns an empty array for an empty string", () => {
    expect(parseDiffLines("")).toEqual([]);
  });

  it("classifies +++ and --- as file headers, not add/del", () => {
    expect(parseDiffLines("--- a/x.ts")[0].kind).toBe("file");
    expect(parseDiffLines("+++ b/x.ts")[0].kind).toBe("file");
  });

  it("classifies hunk headers", () => {
    expect(parseDiffLines("@@ -1,3 +1,4 @@")[0].kind).toBe("hunk");
  });

  it("classifies single + and - as add and del", () => {
    expect(parseDiffLines("+added line")[0].kind).toBe("add");
    expect(parseDiffLines("-removed line")[0].kind).toBe("del");
  });

  it("classifies context and meta lines", () => {
    expect(parseDiffLines(" unchanged")[0].kind).toBe("context");
    expect(parseDiffLines("diff --git a/x b/x")[0].kind).toBe("meta");
    expect(parseDiffLines("index 1234..5678 100644")[0].kind).toBe("meta");
  });

  it("classifies all meta header prefixes", () => {
    expect(parseDiffLines("new file mode 100644")[0].kind).toBe("meta");
    expect(parseDiffLines("deleted file mode 100644")[0].kind).toBe("meta");
    expect(parseDiffLines("similarity index 95%")[0].kind).toBe("meta");
    expect(parseDiffLines("rename from old.ts")[0].kind).toBe("meta");
    expect(parseDiffLines("rename to new.ts")[0].kind).toBe("meta");
  });

  it("does not emit a trailing empty line", () => {
    expect(parseDiffLines("+a\n")).toHaveLength(1);
  });
});
