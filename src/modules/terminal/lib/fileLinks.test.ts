import { describe, expect, it, vi, beforeEach } from "vitest";
import { findFilePaths, resolveFilePath, buildFileLink } from "./fileLinks";
import { showLinkTooltip, hideLinkTooltip } from "./linkTooltip";

vi.mock("./linkTooltip", () => ({
  showLinkTooltip: vi.fn(),
  hideLinkTooltip: vi.fn(),
}));

describe("findFilePaths", () => {
  it("finds a relative path with a line number", () => {
    const matches = findFilePaths("  at src/modules/App.tsx:42:7 in render");
    expect(matches).toHaveLength(1);
    expect(matches[0].text).toBe("src/modules/App.tsx:42:7");
  });

  it("finds absolute and dot-relative paths", () => {
    expect(findFilePaths("see /Users/me/x.rs and ./lib/y.ts").map((m) => m.text)).toEqual([
      "/Users/me/x.rs",
      "./lib/y.ts",
    ]);
  });

  it("reports correct offsets", () => {
    const [m] = findFilePaths("edit App.tsx now");
    expect("edit App.tsx now".slice(m.start, m.end)).toBe("App.tsx");
  });

  it("ignores plain words without an extension", () => {
    expect(findFilePaths("just some regular words here")).toEqual([]);
  });

  it("matches a path whose filename contains CJK characters", () => {
    const line = "exists docs/specs/2026-06-19-新點首頁三新風格EFG-design.md, checked";
    const matches = findFilePaths(line);
    expect(matches).toHaveLength(1);
    expect(matches[0].text).toBe("docs/specs/2026-06-19-新點首頁三新風格EFG-design.md");
  });

  it("matches a path with a CJK directory segment", () => {
    expect(findFilePaths("open 專案/notes.md").map((m) => m.text)).toEqual([
      "專案/notes.md",
    ]);
  });

  it("matches a space-delimited CJK filename cleanly", () => {
    expect(findFilePaths("see 報告.md here").map((m) => m.text)).toEqual(["報告.md"]);
  });

  // Known limitation: CJK has no reliable word boundary, so prose written
  // flush against an ASCII filename (no space) is swallowed into the token.
  // Matching is deliberately broad and the click handler verifies the file
  // exists, so the worst case is an underline that does nothing — documented
  // here so the behaviour is intentional, not an accident.
  it("over-matches CJK prose glued to a filename (documented limitation)", () => {
    expect(findFilePaths("打開config.json").map((m) => m.text)).toEqual([
      "打開config.json",
    ]);
  });

  it("ignores file-looking tokens inside a web URL but still finds real paths", () => {
    const matches = findFilePaths("see https://muki.tw/a.png and ./src/b.ts").map((m) => m.text);
    expect(matches).toContain("./src/b.ts");
    expect(matches.some((m) => m.includes("muki.tw") || m === "a.png")).toBe(false);
  });
});

describe("resolveFilePath", () => {
  it("returns absolute paths unchanged and strips the line suffix", () => {
    expect(resolveFilePath("/Users/me/x.rs:10", "/cwd")).toBe("/Users/me/x.rs");
  });

  it("joins a relative path onto the cwd", () => {
    expect(resolveFilePath("src/App.tsx:5:2", "/Users/me/proj")).toBe(
      "/Users/me/proj/src/App.tsx",
    );
  });

  it("normalises a leading ./ against the cwd", () => {
    expect(resolveFilePath("./lib/y.ts", "/root/")).toBe("/root/lib/y.ts");
  });

  it("expands a leading ~ when home is known", () => {
    expect(resolveFilePath("~/notes/a.md", null, "/Users/me")).toBe("/Users/me/notes/a.md");
  });
});

const range = { start: { x: 1, y: 1 }, end: { x: 5, y: 1 } };
const mouse = (m: Partial<MouseEvent>) =>
  ({ altKey: false, metaKey: false, ctrlKey: false, clientX: 10, clientY: 20, ...m }) as MouseEvent;

describe("buildFileLink", () => {
  beforeEach(() => vi.clearAllMocks());

  it("hover shows the tooltip with the hint and cursor position", () => {
    const link = buildFileLink({ text: "a.ts", range, hint: "Alt / Cmd", isMac: true, onOpen: vi.fn() });
    link.hover?.(mouse({ clientX: 30, clientY: 40 }), "a.ts");
    expect(showLinkTooltip).toHaveBeenCalledWith("Alt / Cmd", 30, 40);
  });

  it("leave hides the tooltip", () => {
    const link = buildFileLink({ text: "a.ts", range, hint: "Alt / Cmd", isMac: true, onOpen: vi.fn() });
    link.leave?.(mouse({}), "a.ts");
    expect(hideLinkTooltip).toHaveBeenCalled();
  });

  it("activate with the platform modifier opens the file", () => {
    const onOpen = vi.fn();
    const link = buildFileLink({ text: "a.ts", range, hint: "Alt / Cmd", isMac: true, onOpen });
    link.activate(mouse({ metaKey: true }), "a.ts");
    expect(onOpen).toHaveBeenCalledWith("a.ts");
  });

  it("activate without a modifier does not open", () => {
    const onOpen = vi.fn();
    const link = buildFileLink({ text: "a.ts", range, hint: "Alt / Cmd", isMac: true, onOpen });
    link.activate(mouse({}), "a.ts");
    expect(onOpen).not.toHaveBeenCalled();
  });
});
