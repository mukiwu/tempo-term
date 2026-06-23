import { describe, expect, it } from "vitest";
import { promptReducer, type PromptState } from "./useSshPrompts";

const empty: PromptState = { queue: [] };

describe("promptReducer", () => {
  it("enqueues an incoming prompt", () => {
    const s = promptReducer(empty, { type: "incoming", req: { id: "1", kind: "hostKeyUnknown", message: "fp" } });
    expect(s.queue).toHaveLength(1);
  });
  it("dequeues by id on reply", () => {
    const s1 = promptReducer(empty, { type: "incoming", req: { id: "1", kind: "password", message: "" } });
    const s2 = promptReducer(s1, { type: "answered", id: "1" });
    expect(s2.queue).toHaveLength(0);
  });
});
