import { describe, expect, it } from "vitest";
import { buildExplainPrompt } from "./explainDiff";

describe("buildExplainPrompt", () => {
  it("includes the file name and the diff body", () => {
    const out = buildExplainPrompt("+added line", "src/app.ts", "en");
    expect(out).toContain("src/app.ts");
    expect(out).toContain("+added line");
  });

  it("asks for Traditional Chinese when lang starts with zh", () => {
    const out = buildExplainPrompt("diff", "f.ts", "zh-Hant");
    expect(out).toContain("正體中文");
  });

  it("asks for English for non-zh langs", () => {
    const out = buildExplainPrompt("diff", "f.ts", "en");
    expect(out).toContain("English");
    expect(out).not.toContain("正體中文");
  });

  it("truncates a diff longer than maxChars and marks it", () => {
    const big = "x".repeat(50);
    const out = buildExplainPrompt(big, "f.ts", "en", 10);
    expect(out).toContain("[truncated]");
    expect(out).not.toContain("x".repeat(50));
    expect(out).toContain("x".repeat(10));
  });

  it("does not truncate a short diff", () => {
    const out = buildExplainPrompt("short", "f.ts", "en", 100);
    expect(out).not.toContain("[truncated]");
  });

  it("redacts secrets from the diff before it reaches the model", () => {
    const out = buildExplainPrompt("+API_KEY=sk-abc123DEF456ghi789jkl012mno345", "f.ts", "en");
    expect(out).toContain("[REDACTED]");
    expect(out).not.toContain("sk-abc123DEF456");
  });
});
