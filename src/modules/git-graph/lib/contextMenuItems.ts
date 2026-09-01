import {
  Copy,
  DownloadCloud,
  FolderGit2,
  GitBranch,
  GitCommit,
  GitMerge,
  GitPullRequestArrow,
  RotateCcw,
  Tag,
  Trash2,
  Undo2,
} from "lucide-react";
import type { ContextMenuItem } from "@/components/ContextMenu";
import type { CommitRef } from "../types";
import { splitRemoteRef } from "./remoteRef";

/**
 * Pure assembly of the git graph's right-click menus. Labels are passed in
 * already localized (and interpolated) so this stays free of i18n, and every
 * action is a pre-bound `() => void` the caller wires to its handlers. Keeping
 * the structure here makes item ids / order / grouping / danger flags testable
 * without rendering the whole tab.
 */

export interface CommitMenuLabels {
  addTag: string;
  createBranch: string;
  checkout: string;
  cherryPick: string;
  revert: string;
  merge: string;
  rebase: string;
  resetSoft: string;
  resetHard: string;
  copyHash: string;
  copySubject: string;
}

export interface CommitMenuActions {
  onAddTag: () => void;
  onCreateBranch: () => void;
  onCheckout: () => void;
  onCherryPick: () => void;
  onRevert: () => void;
  onMerge: () => void;
  onRebase: () => void;
  onResetSoft: () => void;
  onResetHard: () => void;
  onCopyHash: () => void;
  onCopySubject: () => void;
}

export function buildCommitMenu(
  labels: CommitMenuLabels,
  actions: CommitMenuActions,
): ContextMenuItem[] {
  return [
    { id: "addTag", label: labels.addTag, icon: Tag, group: 0, onSelect: actions.onAddTag },
    {
      id: "createBranch",
      label: labels.createBranch,
      icon: GitBranch,
      group: 0,
      onSelect: actions.onCreateBranch,
    },
    {
      id: "checkout",
      label: labels.checkout,
      icon: GitCommit,
      group: 1,
      onSelect: actions.onCheckout,
    },
    {
      id: "cherryPick",
      label: labels.cherryPick,
      icon: GitCommit,
      group: 1,
      onSelect: actions.onCherryPick,
    },
    { id: "revert", label: labels.revert, icon: Undo2, group: 1, onSelect: actions.onRevert },
    { id: "merge", label: labels.merge, icon: GitMerge, group: 2, onSelect: actions.onMerge },
    {
      id: "rebase",
      label: labels.rebase,
      icon: GitPullRequestArrow,
      group: 2,
      onSelect: actions.onRebase,
    },
    {
      id: "resetSoft",
      label: labels.resetSoft,
      icon: RotateCcw,
      group: 2,
      onSelect: actions.onResetSoft,
    },
    {
      id: "resetHard",
      label: labels.resetHard,
      icon: RotateCcw,
      group: 2,
      danger: true,
      onSelect: actions.onResetHard,
    },
    {
      id: "copyHash",
      label: labels.copyHash,
      icon: Copy,
      group: 3,
      onSelect: actions.onCopyHash,
    },
    {
      id: "copySubject",
      label: labels.copySubject,
      icon: Copy,
      group: 3,
      onSelect: actions.onCopySubject,
    },
  ];
}

export interface RefMenuLabels {
  checkout: string;
  merge: string;
  deleteBranch: string;
  deleteTag: string;
  checkoutRemote: string;
  mergeRemote: string;
  pull: string;
  deleteRemote: string;
  copyBranchName: string;
  copyTagName: string;
  openWorktree: string;
  /** Names the remote, for a merged chip where the label alone is ambiguous. */
  pullFrom: (remote: string) => string;
  deleteRemoteOn: (remote: string) => string;
}

export interface RefMenuActions {
  onCheckout: () => void;
  onMerge: () => void;
  onDeleteBranch: () => void;
  onDeleteTag: () => void;
  onCheckoutRemote: () => void;
  onMergeRemote: () => void;
  /** Take the full remote ref name ("origin/master") — a merged chip has several. */
  onPull: (remoteRef: string) => void;
  onDeleteRemote: (remoteRef: string) => void;
  /** Copies the ref's own name — the branch, the remote ref, or the tag. */
  onCopyRefName: () => void;
  onOpenWorktree: () => void;
}

/**
 * `remotes` are the remote refs folded into this chip by `buildRefChips`. They
 * turn the local chip's menu into the one place both halves of a branch are
 * operated on, so the user no longer has to know which chip owns pull.
 */
export function buildRefMenu(
  ref: CommitRef,
  labels: RefMenuLabels,
  actions: RefMenuActions,
  remotes: CommitRef[] = [],
): ContextMenuItem[] {
  if (ref.kind === "tag") {
    return [
      {
        id: "deleteTag",
        label: labels.deleteTag,
        icon: Trash2,
        group: 0,
        danger: true,
        onSelect: actions.onDeleteTag,
      },
      {
        id: "copyTagName",
        label: labels.copyTagName,
        icon: Copy,
        group: 1,
        onSelect: actions.onCopyRefName,
      },
    ];
  }

  if (ref.kind === "branch" || ref.kind === "head") {
    // A merged chip owns both halves of the branch, so its menu runs
    // checkout/merge, then pull, then the deletions, then copy.
    const isBranch = ref.kind === "branch";
    // A detached HEAD is not a branch: none of these act on it, and its name is
    // the literal "HEAD", which is not worth copying.
    if (!isBranch && ref.name === "HEAD") {
      return [];
    }
    const items: ContextMenuItem[] = [];
    if (isBranch) {
      items.push(
        {
          id: "checkout",
          label: labels.checkout,
          icon: GitBranch,
          group: 0,
          onSelect: actions.onCheckout,
        },
        { id: "merge", label: labels.merge, icon: GitMerge, group: 0, onSelect: actions.onMerge },
        {
          // Branch off without leaving what you are doing: unlike checkout, this
          // touches neither the current working tree nor whatever is running in it.
          id: "openWorktree",
          label: labels.openWorktree,
          icon: FolderGit2,
          group: 0,
          onSelect: actions.onOpenWorktree,
        },
      );
    }
    for (const remote of remotes) {
      items.push({
        id: `pull:${remote.name}`,
        label: labels.pullFrom(splitRemoteRef(remote.name).remote),
        icon: DownloadCloud,
        group: 1,
        onSelect: () => actions.onPull(remote.name),
      });
    }
    if (isBranch) {
      items.push({
        id: "deleteBranch",
        label: labels.deleteBranch,
        icon: Trash2,
        group: 2,
        danger: true,
        onSelect: actions.onDeleteBranch,
      });
    }
    for (const remote of remotes) {
      items.push({
        id: `deleteRemote:${remote.name}`,
        label: labels.deleteRemoteOn(splitRemoteRef(remote.name).remote),
        icon: Trash2,
        group: 2,
        danger: true,
        onSelect: () => actions.onDeleteRemote(remote.name),
      });
    }
    // Every branch chip can be copied, remote twin or not — the branch you are
    // standing on is the name most often wanted, and it never has one.
    items.push({
      id: "copyBranchName",
      label: labels.copyBranchName,
      icon: Copy,
      group: 3,
      onSelect: actions.onCopyRefName,
    });
    return items;
  }

  if (ref.kind === "remote") {
    return [
      {
        id: "checkoutRemote",
        label: labels.checkoutRemote,
        icon: GitBranch,
        group: 0,
        onSelect: actions.onCheckoutRemote,
      },
      {
        id: "mergeRemote",
        label: labels.mergeRemote,
        icon: GitMerge,
        group: 0,
        onSelect: actions.onMergeRemote,
      },
      {
        id: "pull",
        label: labels.pull,
        icon: DownloadCloud,
        group: 0,
        onSelect: () => actions.onPull(ref.name),
      },
      {
        id: "deleteRemote",
        label: labels.deleteRemote,
        icon: Trash2,
        group: 1,
        danger: true,
        onSelect: () => actions.onDeleteRemote(ref.name),
      },
      {
        id: "copyBranchName",
        label: labels.copyBranchName,
        icon: Copy,
        group: 2,
        onSelect: actions.onCopyRefName,
      },
    ];
  }

  // Stash and unknown refs have no applicable actions.
  return [];
}
