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

  it("merges a remote listed before its local twin rather than giving it a chip", () => {
    const { chips } = buildRefChips(
      [ref("remote", "origin/feat/x"), ref("tag", "v1"), ref("branch", "feat/x")],
      ALL,
    );

    expect(chips.map((c) => c.label)).toEqual(["feat/x (origin)", "v1"]);
    expect(chips[0].remotes.map((r) => r.name)).toEqual(["origin/feat/x"]);
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

  it("keeps every ref when both options are off, still in the row's order", () => {
    const { chips, overflow } = buildRefChips(
      [ref("head", "master"), ref("remote", "origin/master"), ref("remote", "origin/HEAD")],
      NONE,
    );

    // The options govern what a row shows, not what order it shows it in: the
    // remotes are still here unmerged, they just no longer lead the row.
    expect(chips.map((c) => c.label)).toEqual(["master", "origin/HEAD", "origin/master"]);
    expect(overflow).toEqual([]);
  });

  it("ranks the row by what it is read for: HEAD, branches, tags, then remotes", () => {
    const { chips } = buildRefChips(
      [
        ref("stash", "refs/stash"),
        ref("remote", "origin/solo"),
        ref("tag", "v1"),
        ref("branch", "feature"),
        ref("head", "master"),
      ],
      ALL,
    );

    expect(chips.map((c) => c.label)).toEqual([
      "master",
      "feature",
      "v1",
      "origin/solo",
      "refs/stash",
    ]);
  });

  it("sorts within a kind by name, with origin ahead of the other remotes", () => {
    const { chips } = buildRefChips(
      [
        ref("branch", "zeta"),
        ref("remote", "upstream/solo"),
        ref("branch", "alpha"),
        ref("remote", "origin/solo"),
      ],
      ALL,
    );

    expect(chips.map((c) => c.label)).toEqual([
      "alpha",
      "zeta",
      "origin/solo",
      "upstream/solo",
    ]);
  });

  it("puts origin's block first inside a merged chip", () => {
    const { chips } = buildRefChips(
      [
        ref("branch", "master"),
        ref("remote", "upstream/master"),
        ref("remote", "origin/master"),
      ],
      ALL,
    );

    expect(chips[0].remoteNames).toEqual(["origin", "upstream"]);
    expect(chips[0].label).toBe("master (origin, upstream)");
  });

  it("collapses the least important refs, not whichever git listed last", () => {
    const { chips, overflow } = buildRefChips(
      [
        ref("remote", "origin/solo"),
        ref("tag", "v1"),
        ref("head", "master"),
        ref("branch", "feature"),
      ],
      { ...ALL, collapseAfter: 2 },
    );

    // Git lists the remote first; the row keeps HEAD and the branch instead.
    expect(chips.map((c) => c.label)).toEqual(["master", "feature"]);
    expect(overflow.map((c) => c.label)).toEqual(["v1", "origin/solo"]);
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
