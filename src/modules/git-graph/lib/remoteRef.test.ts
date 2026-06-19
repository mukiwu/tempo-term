import { describe, expect, it } from "vitest";
import { splitRemoteRef } from "./remoteRef";

describe("splitRemoteRef", () => {
  it("splits a remote ref into remote and branch on the first slash", () => {
    expect(splitRemoteRef("origin/feat/notes-watcher")).toEqual({
      remote: "origin",
      branch: "feat/notes-watcher",
    });
  });

  it("handles a simple single-segment branch", () => {
    expect(splitRemoteRef("origin/main")).toEqual({
      remote: "origin",
      branch: "main",
    });
  });

  it("keeps the rest intact when the branch name contains slashes", () => {
    expect(splitRemoteRef("upstream/release/1.2/hotfix")).toEqual({
      remote: "upstream",
      branch: "release/1.2/hotfix",
    });
  });

  it("returns an empty branch when there is no slash", () => {
    expect(splitRemoteRef("origin")).toEqual({ remote: "origin", branch: "" });
  });
});
