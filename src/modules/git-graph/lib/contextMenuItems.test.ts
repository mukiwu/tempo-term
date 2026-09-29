import { describe, expect, it, vi } from "vitest";
import {
  buildCommitMenu,
  buildRefMenu,
  buildWorkingTreeMenu,
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
  copyTagName: "Copy tag name",
  openWorktree: "Open worktree for this branch",
  useAsComparisonBase: "Use as comparison base",
  pullFrom: (remote: string) => `Pull from ${remote}`,
  deleteRemoteOn: (remote: string) => `Delete branch on ${remote}`,
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
    onCopyRefName: vi.fn(),
    onOpenWorktree: vi.fn(),
    onUseAsComparisonBase: vi.fn(),
  };
}

const commitLabels: CommitMenuLabels = {
  openChanges: "Open changes",
  compareWithWorkingTree: "Compare with working tree",
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
    onOpenChanges: vi.fn(),
    onCompareWithWorkingTree: vi.fn(),
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
      "useAsComparisonBase",
      "checkoutRemote",
      "mergeRemote",
      "pull",
      "deleteRemote",
      "copyBranchName",
    ]);
    expect(items.find((i) => i.id === "deleteRemote")?.danger).toBe(true);
    expect(items.find((i) => i.id === "copyBranchName")?.danger).toBeFalsy();
  });

  it("offers delete in the danger colour, then copy, for a tag", () => {
    const actions = refActions();
    const ref: CommitRef = { name: "v1.0.0", kind: "tag" };
    const items = buildRefMenu(ref, refLabels, actions);
    expect(ids(items)).toEqual(["deleteTag", "copyTagName"]);
    expect(items[0].danger).toBe(true);
    const copy = items[1];
    expect(copy.danger).toBeFalsy();
    // The delete sits in its own group so a divider fences it off from copy.
    expect(copy.group).not.toBe(items[0].group);
    copy.onSelect();
    expect(actions.onCopyRefName).toHaveBeenCalledTimes(1);
  });

  it("offers copy on a local branch that has no remote yet", () => {
    const ref: CommitRef = { name: "feature", kind: "branch" };
    const items = buildRefMenu(ref, refLabels, refActions());
    expect(ids(items)).toEqual([
      "useAsComparisonBase",
      "checkout",
      "merge",
      "openWorktree",
      "deleteBranch",
      "copyBranchName",
    ]);
    expect(items.find((i) => i.id === "deleteBranch")?.danger).toBe(true);
  });

  it("offers copy on the current branch (head) with no remote folded in", () => {
    const actions = refActions();
    const ref: CommitRef = { name: "main", kind: "head" };
    const items = buildRefMenu(ref, refLabels, actions);
    // Checkout, merge and delete do not apply to the branch already checked
    // out, but its name is the one most often wanted.
    expect(ids(items)).toEqual(["copyBranchName"]);
    items[0].onSelect();
    expect(actions.onCopyRefName).toHaveBeenCalledTimes(1);
  });

  it("offers the comparison base first, in a group of its own, on branch and remote chips", () => {
    const actions = refActions();
    for (const ref of [
      { name: "feature", kind: "branch" },
      { name: "origin/feature", kind: "remote" },
    ] as CommitRef[]) {
      const items = buildRefMenu(ref, refLabels, actions);
      expect(items[0].id).toBe("useAsComparisonBase");
      expect(items.filter((i) => i.group === items[0].group)).toHaveLength(1);
    }
    const branch = buildRefMenu({ name: "feature", kind: "branch" }, refLabels, actions);
    branch[0].onSelect();
    expect(actions.onUseAsComparisonBase).toHaveBeenCalledTimes(1);
  });

  it("does not offer the comparison base on head, tag or stash chips", () => {
    for (const ref of [
      { name: "main", kind: "head" },
      { name: "HEAD", kind: "head" },
      { name: "v1.0.0", kind: "tag" },
      { name: "stash@{0}", kind: "stash" },
    ] as CommitRef[]) {
      expect(ids(buildRefMenu(ref, refLabels, refActions()))).not.toContain("useAsComparisonBase");
    }
  });

  it("offers nothing for a detached HEAD", () => {
    const ref: CommitRef = { name: "HEAD", kind: "head" };
    expect(buildRefMenu(ref, refLabels, refActions())).toEqual([]);
  });

  it("covers local and remote actions in one menu for a merged chip", () => {
    const ref: CommitRef = { name: "master", kind: "branch" };
    const remotes: CommitRef[] = [{ name: "origin/master", kind: "remote" }];
    const items = buildRefMenu(ref, refLabels, refActions(), remotes);
    expect(ids(items)).toEqual([
      "useAsComparisonBase",
      "checkout",
      "merge",
      "openWorktree",
      "pull:origin/master",
      "deleteBranch",
      "deleteRemote:origin/master",
      "copyBranchName",
    ]);
    // Both deletions sit in the same group so one divider fences them off.
    expect(items.find((i) => i.id === "deleteBranch")?.group).toBe(3);
    expect(items.find((i) => i.id === "deleteRemote:origin/master")?.group).toBe(3);
    expect(items.find((i) => i.id === "deleteRemote:origin/master")?.danger).toBe(true);
  });

  it("gives the current branch its remotes' actions once they are merged in", () => {
    const ref: CommitRef = { name: "master", kind: "head" };
    const remotes: CommitRef[] = [
      { name: "origin/master", kind: "remote" },
      { name: "upstream/master", kind: "remote" },
    ];
    const items = buildRefMenu(ref, refLabels, refActions(), remotes);
    expect(ids(items)).toEqual([
      "pull:origin/master",
      "pull:upstream/master",
      "deleteRemote:origin/master",
      "deleteRemote:upstream/master",
      "copyBranchName",
    ]);
    // With several remotes the label has to say which one it acts on.
    expect(items[0].label).toBe("Pull from origin");
    expect(items[1].label).toBe("Pull from upstream");
    // The current branch is what the page compares against already.
    expect(ids(items)).not.toContain("useAsComparisonBase");
  });

  it("passes each merged remote's own ref name to pull and delete", () => {
    const actions = refActions();
    const ref: CommitRef = { name: "master", kind: "head" };
    const remotes: CommitRef[] = [
      { name: "origin/master", kind: "remote" },
      { name: "upstream/master", kind: "remote" },
    ];
    const items = buildRefMenu(ref, refLabels, actions, remotes);
    items.find((i) => i.id === "pull:upstream/master")?.onSelect();
    items.find((i) => i.id === "deleteRemote:origin/master")?.onSelect();
    expect(actions.onPull).toHaveBeenCalledWith("upstream/master");
    expect(actions.onDeleteRemote).toHaveBeenCalledWith("origin/master");
  });

  it("wires the remote actions to their callbacks", () => {
    const actions = refActions();
    const ref: CommitRef = { name: "origin/feat/x", kind: "remote" };
    const items = buildRefMenu(ref, refLabels, actions);
    items.find((i) => i.id === "copyBranchName")?.onSelect();
    items.find((i) => i.id === "checkoutRemote")?.onSelect();
    items.find((i) => i.id === "pull")?.onSelect();
    items.find((i) => i.id === "deleteRemote")?.onSelect();
    expect(actions.onCopyRefName).toHaveBeenCalledTimes(1);
    expect(actions.onCheckoutRemote).toHaveBeenCalledTimes(1);
    expect(actions.onPull).toHaveBeenCalledWith("origin/feat/x");
    expect(actions.onDeleteRemote).toHaveBeenCalledWith("origin/feat/x");
  });
});

describe("buildCommitMenu", () => {
  it("lists the VSCode-style commit actions in order", () => {
    const items = buildCommitMenu(commitLabels, commitActions());
    expect(ids(items)).toEqual([
      "openChanges",
      "compareWithWorkingTree",
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

  it("keeps the read-changes items in a first group of their own, ahead of the rest", () => {
    const items = buildCommitMenu(commitLabels, commitActions());
    expect(items.filter((i) => i.group === 0).map((i) => i.id)).toEqual([
      "openChanges",
      "compareWithWorkingTree",
    ]);
    // Groups only ever rise, so dividers land between the same items as before.
    const groups = items.map((i) => i.group ?? 0);
    expect(groups).toEqual([...groups].sort((a, b) => a - b));
    expect(items.find((i) => i.id === "addTag")?.group).toBe(1);
    expect(items.find((i) => i.id === "copyHash")?.group).toBe(4);
  });

  it("omits open changes for a root commit but still offers the working-tree comparison", () => {
    const actions = commitActions();
    const items = buildCommitMenu(commitLabels, { ...actions, onOpenChanges: undefined });
    expect(ids(items)).not.toContain("openChanges");
    items.find((i) => i.id === "compareWithWorkingTree")?.onSelect();
    expect(actions.onCompareWithWorkingTree).toHaveBeenCalledTimes(1);
  });

  it("wires open changes to its callback", () => {
    const actions = commitActions();
    buildCommitMenu(commitLabels, actions)
      .find((i) => i.id === "openChanges")
      ?.onSelect();
    expect(actions.onOpenChanges).toHaveBeenCalledTimes(1);
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

describe("buildWorkingTreeMenu", () => {
  const labels = { openSourceControl: "Open in Source Control", refresh: "Refresh" };

  it("offers only the two actions the working tree can actually do", () => {
    // Nothing from the commit menu applies: there is no hash to copy and
    // nothing to check out. Staging/stashing/discarding all wait on backend
    // capabilities the app does not have yet.
    const items = buildWorkingTreeMenu(labels, {
      onOpenSourceControl: vi.fn(),
      onRefresh: vi.fn(),
    });
    expect(items.map((i) => i.id)).toEqual(["openSourceControl", "refresh"]);
    expect(items.map((i) => i.label)).toEqual(["Open in Source Control", "Refresh"]);
    // One group, so no separator is drawn between two items that belong together.
    expect(new Set(items.map((i) => i.group))).toEqual(new Set([0]));
    expect(items.some((i) => i.danger)).toBe(false);
  });

  it("wires each item to its own action", () => {
    const onOpenSourceControl = vi.fn();
    const onRefresh = vi.fn();
    const items = buildWorkingTreeMenu(labels, { onOpenSourceControl, onRefresh });
    items.find((i) => i.id === "openSourceControl")?.onSelect();
    expect(onOpenSourceControl).toHaveBeenCalledTimes(1);
    expect(onRefresh).not.toHaveBeenCalled();
    items.find((i) => i.id === "refresh")?.onSelect();
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});
