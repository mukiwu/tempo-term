import { describe, expect, it } from "vitest";
import { composeMessages, type ChatMessage } from "./chat";

const history: ChatMessage[] = [
  { role: "user", content: "first" },
  { role: "assistant", content: "reply" },
];

describe("composeMessages", () => {
  it("prepends a system prompt, then history, then the new user message", () => {
    const result = composeMessages("you are helpful", history, "second");
    expect(result[0]).toEqual({ role: "system", content: "you are helpful" });
    expect(result.slice(1, 3)).toEqual(history);
    expect(result[result.length - 1]).toEqual({ role: "user", content: "second" });
  });

  it("omits the system message when the prompt is empty", () => {
    const result = composeMessages("", history, "hello");
    expect(result.some((m) => m.role === "system")).toBe(false);
    expect(result[result.length - 1]).toEqual({ role: "user", content: "hello" });
  });

  it("works with no history", () => {
    const result = composeMessages("sys", [], "hi");
    expect(result).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "hi" },
    ]);
  });

  it("does not mutate the provided history", () => {
    const copy = [...history];
    composeMessages("sys", history, "x");
    expect(history).toEqual(copy);
  });
});
