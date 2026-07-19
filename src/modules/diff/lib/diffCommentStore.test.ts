import { beforeEach, describe, expect, it } from "vitest";
import { useDiffCommentStore } from "./diffCommentStore";

function add(over: Partial<Parameters<ReturnType<typeof useDiffCommentStore.getState>["add"]>[0]> = {}) {
  useDiffCommentStore.getState().add({
    path: "/repo/a.ts",
    staged: false,
    side: "b",
    line: 3,
    lineText: "const x = 1;",
    body: "why not const y?",
    ...over,
  });
}

describe("diffCommentStore", () => {
  beforeEach(() => {
    useDiffCommentStore.setState({ comments: [] });
  });

  it("adds a comment as unsent with an id", () => {
    add();
    const [comment] = useDiffCommentStore.getState().comments;
    expect(comment.id).toBeTruthy();
    expect(comment.sent).toBe(false);
    expect(comment.body).toBe("why not const y?");
  });

  it("removes a comment by id", () => {
    add();
    const [comment] = useDiffCommentStore.getState().comments;
    useDiffCommentStore.getState().remove(comment.id);
    expect(useDiffCommentStore.getState().comments).toHaveLength(0);
  });

  it("marks only the given ids as sent", () => {
    add();
    add({ body: "second" });
    const [first, second] = useDiffCommentStore.getState().comments;
    useDiffCommentStore.getState().markSent([first.id]);
    const after = useDiffCommentStore.getState().comments;
    expect(after.find((c) => c.id === first.id)?.sent).toBe(true);
    expect(after.find((c) => c.id === second.id)?.sent).toBe(false);
  });

  it("moves re-anchored comments to their new lines", () => {
    add();
    const [comment] = useDiffCommentStore.getState().comments;
    useDiffCommentStore.getState().reanchor([{ id: comment.id, line: 9 }]);
    expect(useDiffCommentStore.getState().comments[0].line).toBe(9);
  });
});
