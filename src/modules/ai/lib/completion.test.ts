import { describe, expect, it } from "vitest";
import { buildCompletionMessages, cleanCompletion } from "./completion";

describe("cleanCompletion", () => {
  it("passes plain text through unchanged", () => {
    expect(cleanCompletion("1 + 2")).toBe("1 + 2");
  });

  it("unwraps a fenced code block with a language tag", () => {
    expect(cleanCompletion("```ts\nconst x = 1\n```")).toBe("const x = 1");
  });

  it("unwraps a bare fenced code block", () => {
    expect(cleanCompletion("```\nfoo bar\n```")).toBe("foo bar");
  });

  it("strips the echoed prefix line the model repeats back", () => {
    expect(cleanCompletion("const x = 1 + 2", "const x = ")).toBe("1 + 2");
  });

  it("only strips the echo of the current line, not earlier lines", () => {
    expect(cleanCompletion("  return n", "function f() {\n  ")).toBe("return n");
  });
});

describe("buildCompletionMessages", () => {
  it("returns a system instruction followed by the code context", () => {
    const messages = buildCompletionMessages("const x = ", "\nconsole.log(x)", "typescript");
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("system");
    expect(messages[1].role).toBe("user");
    expect(messages[1].content).toContain("const x = ");
    expect(messages[1].content).toContain("console.log(x)");
    expect(messages[1].content.toLowerCase()).toContain("typescript");
  });
});
