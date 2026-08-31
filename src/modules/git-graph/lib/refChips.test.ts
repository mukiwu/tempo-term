import { describe, expect, it } from "vitest";
import { buildRefChips, DEFAULT_REF_CHIP_OPTIONS, type RefChipOptions } from "./refChips";
import type { CommitRef } from "../types";

const ALL: RefChipOptions = { mergeLocalRemote: true, hideOriginHead: true, collapseAfter: null };
const NONE: RefChipOptions = {
  mergeLocalRemote: false,
  hideOriginHead: false,
  collapseAfter: null,
};

function ref(kind: string, name: string): CommitRef {
  return { kind, name };
}

describe("buildRefChips", () => {
  it("folds the same-named remote into the local chip and labels the remote after it", () => {
    const { chips } = buildRefChips(
      [ref("head", "master"), ref("remote", "origin/master")],
      ALL,
    );

    expect(chips).toHaveLength(1);
    expect(chips[0].label).toBe("master (origin)");
    expect(chips[0].remoteNames).toEqual(["origin"]);
    expect(chips[0].ref.kind).toBe("head");
    expect(chips[0].remotes.map((r) => r.name)).toEqual(["origin/master"]);
  });

  it("chains every remote that has the branch at this commit", () => {
    const { chips } = buildRefChips(
      [ref("branch", "master"), ref("remote", "origin/master"), ref("remote", "upstream/master")],
      ALL,
    );

    expect(chips).toHaveLength(1);
    expect(chips[0].label).toBe("master (origin, upstream)");
    expect(chips[0].remoteNames).toEqual(["origin", "upstream"]);
  });

  it("merges a remote listed before its local twin, keeping the local ref's slot", () => {
    const { chips } = buildRefChips(
      [ref("remote", "origin/feat/x"), ref("tag", "v1"), ref("branch", "feat/x")],
      ALL,
    );

    expect(chips.map((c) => c.label)).toEqual(["v1", "feat/x (origin)"]);
    expect(chips[1].remotes.map((r) => r.name)).toEqual(["origin/feat/x"]);
  });

  it("leaves a remote with no local twin here as its own origin/ chip", () => {
    const { chips } = buildRefChips([ref("remote", "origin/master")], ALL);

    expect(chips.map((c) => c.label)).toEqual(["origin/master"]);
    expect(chips[0].ref.kind).toBe("remote");
  });

  it("never folds a detached HEAD into origin/HEAD", () => {
    const { chips } = buildRefChips([ref("head", "HEAD"), ref("remote", "origin/HEAD")], {
      ...ALL,
      hideOriginHead: false,
    });

    expect(chips.map((c) => c.label)).toEqual(["HEAD", "origin/HEAD"]);
  });

  it("hides origin/HEAD, and keeps it when the option is off", () => {
    const refs = [ref("head", "master"), ref("remote", "origin/HEAD")];

    expect(buildRefChips(refs, ALL).chips.map((c) => c.label)).toEqual(["master"]);
    expect(buildRefChips(refs, { ...ALL, hideOriginHead: false }).chips.map((c) => c.label)).toEqual(
      ["master", "origin/HEAD"],
    );
  });

  it("leaves every ref alone when both options are off", () => {
    const { chips, overflow } = buildRefChips(
      [ref("head", "master"), ref("remote", "origin/master"), ref("remote", "origin/HEAD")],
      NONE,
    );

    expect(chips.map((c) => c.label)).toEqual(["master", "origin/master", "origin/HEAD"]);
    expect(overflow).toEqual([]);
  });

  it("collapses everything past the threshold into the overflow list", () => {
    const refs = [
      ref("head", "master"),
      ref("branch", "a"),
      ref("branch", "b"),
      ref("branch", "c"),
      ref("tag", "v1"),
    ];

    const { chips, overflow } = buildRefChips(refs, { ...ALL, collapseAfter: 3 });

    expect(chips.map((c) => c.label)).toEqual(["master", "a", "b"]);
    expect(overflow.map((c) => c.label)).toEqual(["c", "v1"]);
  });

  it("counts merged chips, not raw refs, against the threshold", () => {
    const { chips, overflow } = buildRefChips(
      [
        ref("head", "master"),
        ref("remote", "origin/master"),
        ref("remote", "origin/HEAD"),
        ref("branch", "a"),
      ],
      { ...ALL, collapseAfter: 3 },
    );

    expect(chips.map((c) => c.label)).toEqual(["master (origin)", "a"]);
    expect(overflow).toEqual([]);
  });

  it("defaults to merging, hiding origin/HEAD and collapsing past three", () => {
    expect(DEFAULT_REF_CHIP_OPTIONS).toEqual({
      mergeLocalRemote: true,
      hideOriginHead: true,
      collapseAfter: 3,
    });
  });
});
