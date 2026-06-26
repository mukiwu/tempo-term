import { describe, expect, it } from "vitest";
import { buildCommitPrompt, sanitizeCommitMessage } from "./aiCommit";

describe("buildCommitPrompt", () => {
  it("includes the diff content", () => {
    expect(buildCommitPrompt("diff --git a/x b/x")).toContain("diff --git a/x b/x");
  });

  it("truncates very large diffs to keep the request bounded", () => {
    const huge = "x".repeat(50000);
    const prompt = buildCommitPrompt(huge, 1000);
    expect(prompt.length).toBeLessThan(2000);
    expect(prompt).toContain("truncated");
  });

  it("redacts secrets from the diff before it reaches the model", () => {
    const prompt = buildCommitPrompt("+API_KEY=sk-abc123DEF456ghi789jkl012mno345");
    expect(prompt).toContain("[REDACTED]");
    expect(prompt).not.toContain("sk-abc123DEF456");
  });
});

describe("sanitizeCommitMessage", () => {
  it("strips surrounding markdown code fences", () => {
    expect(sanitizeCommitMessage("```\nfeat: add thing\n```")).toBe("feat: add thing");
    expect(sanitizeCommitMessage("```text\nfix: bug\n```")).toBe("fix: bug");
  });

  it("trims whitespace and leaves a plain message untouched", () => {
    expect(sanitizeCommitMessage("  chore: tidy  ")).toBe("chore: tidy");
  });
});
