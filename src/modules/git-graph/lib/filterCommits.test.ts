import { describe, expect, it } from "vitest";
import { commitMatches, findCommitMatchIndexes } from "./filterCommits";
import type { CommitNode } from "../types";

function commit(overrides: Partial<CommitNode> = {}): CommitNode {
  return {
    hash: "abc1234",
    parents: [],
    author: "Alice",
    date: "2026-06-18 10:00",
    message: "Add login form",
    refs: [],
    ...overrides,
  };
}

describe("findCommitMatchIndexes", () => {
  it("returns every index when query is empty", () => {
    const commits = [commit(), commit({ hash: "def5678" })];
    expect(findCommitMatchIndexes(commits, "")).toEqual([0, 1]);
  });

  it("returns every index when query is whitespace", () => {
    const commits = [commit()];
    expect(findCommitMatchIndexes(commits, "   ")).toEqual([0]);
  });

  it("returns indexes matching the message case-insensitively", () => {
    const commits = [commit({ message: "Fix navbar" }), commit({ message: "Add login" })];
    expect(findCommitMatchIndexes(commits, "LOGIN")).toEqual([1]);
  });

  it("returns indexes matching the author", () => {
    const commits = [commit({ author: "Bob" }), commit({ author: "Alice" })];
    expect(findCommitMatchIndexes(commits, "bob")).toEqual([0]);
  });

  it("returns indexes matching the hash", () => {
    const commits = [commit({ hash: "abc1234" }), commit({ hash: "def5678" })];
    expect(findCommitMatchIndexes(commits, "def")).toEqual([1]);
  });

  it("returns empty array when nothing matches", () => {
    const commits = [commit()];
    expect(findCommitMatchIndexes(commits, "zzz")).toEqual([]);
  });
});

describe("commitMatches", () => {
  it("answers true for an empty query, which callers asking “is this a match” must guard", () => {
    // The counter wants "everything matches" here; a row asking whether it is
    // one gets the same answer and has to check for a running search itself.
    expect(commitMatches(commit(), "")).toBe(true);
    expect(commitMatches(commit(), "   ")).toBe(true);
  });

  it("reads the message, the author and the hash, and nothing else", () => {
    expect(commitMatches(commit(), "login")).toBe(true);
    expect(commitMatches(commit(), "alice")).toBe(true);
    expect(commitMatches(commit(), "abc12")).toBe(true);
    // The date is deliberately not searched, so a row must not mark it either.
    expect(commitMatches(commit(), "2026-06-18")).toBe(false);
  });
});
