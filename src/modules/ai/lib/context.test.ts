import { describe, expect, it } from "vitest";
import { buildActiveFileBlock, buildTerminalBlock } from "./context";

describe("buildActiveFileBlock", () => {
  it("returns empty string when there is no active file path", () => {
    expect(buildActiveFileBlock(null, "some content")).toBe("");
    expect(buildActiveFileBlock("", "some content")).toBe("");
  });

  it("returns empty string when the file content is blank", () => {
    expect(buildActiveFileBlock("/a/b.ts", "")).toBe("");
    expect(buildActiveFileBlock("/a/b.ts", "   \n  ")).toBe("");
  });

  it("includes the file path and its content", () => {
    const block = buildActiveFileBlock("/a/b.ts", "const x = 1");
    expect(block).toContain("/a/b.ts");
    expect(block).toContain("const x = 1");
  });

  it("truncates very long content with a marker", () => {
    const block = buildActiveFileBlock("/a/big.ts", "x".repeat(20000));
    expect(block).toContain("[truncated]");
    expect(block.length).toBeLessThan(20000);
  });
});

describe("buildTerminalBlock", () => {
  it("returns empty string for blank terminal output", () => {
    expect(buildTerminalBlock("")).toBe("");
    expect(buildTerminalBlock("  \n \n ")).toBe("");
  });

  it("includes the terminal output and a label so the model knows the source", () => {
    const block = buildTerminalBlock("$ npm test\nError: boom");
    expect(block.toLowerCase()).toContain("terminal");
    expect(block).toContain("$ npm test");
    expect(block).toContain("Error: boom");
  });

  it("keeps only the last lines when the output is very long", () => {
    const lines = Array.from({ length: 500 }, (_, i) => `line ${i}`).join("\n");
    const block = buildTerminalBlock(lines, 100);
    expect(block).toContain("line 499");
    expect(block).not.toContain("line 0\n");
  });
});
