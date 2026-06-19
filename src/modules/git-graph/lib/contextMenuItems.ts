import {
  Copy,
  DownloadCloud,
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
}

export interface RefMenuActions {
  onCheckout: () => void;
  onMerge: () => void;
  onDeleteBranch: () => void;
  onDeleteTag: () => void;
  onCheckoutRemote: () => void;
  onMergeRemote: () => void;
  onPull: () => void;
  onDeleteRemote: () => void;
  onCopyBranchName: () => void;
}

export function buildRefMenu(
  ref: CommitRef,
  labels: RefMenuLabels,
  actions: RefMenuActions,
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
    ];
  }

  if (ref.kind === "branch") {
    return [
      {
        id: "checkout",
        label: labels.checkout,
        icon: GitBranch,
        group: 0,
        onSelect: actions.onCheckout,
      },
      { id: "merge", label: labels.merge, icon: GitMerge, group: 0, onSelect: actions.onMerge },
      {
        id: "deleteBranch",
        label: labels.deleteBranch,
        icon: Trash2,
        group: 1,
        danger: true,
        onSelect: actions.onDeleteBranch,
      },
    ];
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
        onSelect: actions.onPull,
      },
      {
        id: "deleteRemote",
        label: labels.deleteRemote,
        icon: Trash2,
        group: 1,
        danger: true,
        onSelect: actions.onDeleteRemote,
      },
      {
        id: "copyBranchName",
        label: labels.copyBranchName,
        icon: Copy,
        group: 2,
        onSelect: actions.onCopyBranchName,
      },
    ];
  }

  // head (current branch) and unknown refs have no applicable actions.
  return [];
}
