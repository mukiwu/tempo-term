import { describe, expect, it, vi } from "vitest";
import {
  buildCommitMenu,
  buildRefMenu,
  type CommitMenuActions,
  type CommitMenuLabels,
  type RefMenuActions,
  type RefMenuLabels,
} from "./contextMenuItems";
import type { CommitRef } from "../types";

const refLabels: RefMenuLabels = {
  checkout: "Checkout branch",
  merge: "Merge into current",
  deleteBranch: "Delete branch",
  deleteTag: "Delete tag",
  checkoutRemote: "Checkout branch",
  mergeRemote: "Merge into current branch",
  pull: "Pull into current branch",
  deleteRemote: "Delete remote branch",
  copyBranchName: "Copy branch name",
};

function refActions(): RefMenuActions {
  return {
    onCheckout: vi.fn(),
    onMerge: vi.fn(),
    onDeleteBranch: vi.fn(),
    onDeleteTag: vi.fn(),
    onCheckoutRemote: vi.fn(),
    onMergeRemote: vi.fn(),
    onPull: vi.fn(),
    onDeleteRemote: vi.fn(),
    onCopyBranchName: vi.fn(),
  };
}

const commitLabels: CommitMenuLabels = {
  addTag: "Add tag",
  createBranch: "Create branch",
  checkout: "Checkout",
  cherryPick: "Cherry-pick",
  revert: "Revert",
  merge: "Merge into current branch",
  rebase: "Rebase current branch on this commit",
  resetSoft: "Reset (soft)",
  resetHard: "Reset (hard)",
  copyHash: "Copy commit hash",
  copySubject: "Copy commit subject",
};

function commitActions(): CommitMenuActions {
  return {
    onAddTag: vi.fn(),
    onCreateBranch: vi.fn(),
    onCheckout: vi.fn(),
    onCherryPick: vi.fn(),
    onRevert: vi.fn(),
    onMerge: vi.fn(),
    onRebase: vi.fn(),
    onResetSoft: vi.fn(),
    onResetHard: vi.fn(),
    onCopyHash: vi.fn(),
    onCopySubject: vi.fn(),
  };
}

const ids = (items: { id: string }[]) => items.map((i) => i.id);

describe("buildRefMenu", () => {
  it("gives a remote branch the full VSCode-style action set", () => {
    const ref: CommitRef = { name: "origin/feat/x", kind: "remote" };
    const items = buildRefMenu(ref, refLabels, refActions());
    expect(ids(items)).toEqual([
      "checkoutRemote",
      "mergeRemote",
      "pull",
      "deleteRemote",
      "copyBranchName",
    ]);
    expect(items.find((i) => i.id === "deleteRemote")?.danger).toBe(true);
    expect(items.find((i) => i.id === "copyBranchName")?.danger).toBeFalsy();
  });

  it("offers only delete for a tag, in the danger colour", () => {
    const ref: CommitRef = { name: "v1.0.0", kind: "tag" };
    const items = buildRefMenu(ref, refLabels, refActions());
    expect(ids(items)).toEqual(["deleteTag"]);
    expect(items[0].danger).toBe(true);
  });

  it("offers checkout, merge and delete for a local branch", () => {
    const ref: CommitRef = { name: "feature", kind: "branch" };
    const items = buildRefMenu(ref, refLabels, refActions());
    expect(ids(items)).toEqual(["checkout", "merge", "deleteBranch"]);
    expect(items.find((i) => i.id === "deleteBranch")?.danger).toBe(true);
  });

  it("offers nothing for the current branch (head)", () => {
    const ref: CommitRef = { name: "main", kind: "head" };
    expect(buildRefMenu(ref, refLabels, refActions())).toEqual([]);
  });

  it("wires the remote actions to their callbacks", () => {
    const actions = refActions();
    const ref: CommitRef = { name: "origin/feat/x", kind: "remote" };
    const items = buildRefMenu(ref, refLabels, actions);
    items.find((i) => i.id === "copyBranchName")?.onSelect();
    items.find((i) => i.id === "checkoutRemote")?.onSelect();
    items.find((i) => i.id === "pull")?.onSelect();
    items.find((i) => i.id === "deleteRemote")?.onSelect();
    expect(actions.onCopyBranchName).toHaveBeenCalledTimes(1);
    expect(actions.onCheckoutRemote).toHaveBeenCalledTimes(1);
    expect(actions.onPull).toHaveBeenCalledTimes(1);
    expect(actions.onDeleteRemote).toHaveBeenCalledTimes(1);
  });
});

describe("buildCommitMenu", () => {
  it("lists the VSCode-style commit actions in order", () => {
    const items = buildCommitMenu(commitLabels, commitActions());
    expect(ids(items)).toEqual([
      "addTag",
      "createBranch",
      "checkout",
      "cherryPick",
      "revert",
      "merge",
      "rebase",
      "resetSoft",
      "resetHard",
      "copyHash",
      "copySubject",
    ]);
    expect(items.find((i) => i.id === "resetHard")?.danger).toBe(true);
  });

  it("wires copy actions to their callbacks", () => {
    const actions = commitActions();
    const items = buildCommitMenu(commitLabels, actions);
    items.find((i) => i.id === "copyHash")?.onSelect();
    items.find((i) => i.id === "copySubject")?.onSelect();
    expect(actions.onCopyHash).toHaveBeenCalledTimes(1);
    expect(actions.onCopySubject).toHaveBeenCalledTimes(1);
  });
});
