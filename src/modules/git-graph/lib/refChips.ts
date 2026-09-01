import type { CommitRef } from "../types";
import { splitRemoteRef } from "./remoteRef";

/** How a commit row turns its raw refs into the chips it actually paints. */
export interface RefChipOptions {
  /** Fold `origin/x` into the local `x` chip when both point here. */
  mergeLocalRemote: boolean;
  /** Drop `origin/HEAD` — a symbolic link to the remote's default branch. */
  hideOriginHead: boolean;
  /** Keep at most this many chips on the row; null keeps them all. */
  collapseAfter: number | null;
}

export const DEFAULT_REF_CHIP_OPTIONS: RefChipOptions = {
  mergeLocalRemote: true,
  hideOriginHead: true,
  collapseAfter: 3,
};

/** One painted chip: a ref plus any same-named remote refs folded into it. */
export interface RefChip {
  /** Stable React key. */
  key: string;
  /** Drives the chip style and its local actions (the local ref when merged). */
  ref: CommitRef;
  /** Remote refs folded into this chip, in the order git listed them. */
  remotes: CommitRef[];
  /** The remotes' short names ("origin", "upstream"), one painted block each. */
  remoteNames: string[];
  /** Plain-text name for tooltips: "master", or "master (origin, upstream)". */
  label: string;
}

/** A row's chips, split into what fits and what the `+N` chip hides. */
export interface RefChipRow {
  chips: RefChip[];
  overflow: RefChip[];
}

/** Local branch refs a remote ref can be folded into. Detached HEAD is not one. */
function localBranchName(ref: CommitRef): string | null {
  if (ref.kind === "branch") {
    return ref.name;
  }
  // "HEAD" as a head ref is a detached HEAD, not a branch anything tracks.
  if (ref.kind === "head" && ref.name !== "HEAD") {
    return ref.name;
  }
  return null;
}

/** What a reader looks for first on a commit row, by ref kind. */
const KIND_RANK: Record<string, number> = {
  head: 0,
  branch: 1,
  tag: 2,
  remote: 3,
  stash: 4,
  unknown: 5,
};

/** "origin" is the remote nearly every repo pushes to; it leads its own kind. */
function remoteRank(name: string): [number, string] {
  const remote = splitRemoteRef(name).remote;
  return [remote === "origin" ? 0 : 1, remote];
}

/**
 * Order two chips for the row.
 *
 * Git lists decorations in the reverse of the order it walked the refs, so
 * `refs/remotes/…` lands before `refs/heads/…` — an implementation detail that
 * means nothing to a reader, and that decides which chips `collapseAfter`
 * hides. Rank by what the row is actually read for instead: where HEAD is,
 * then the branches you act on, then the tags, then the remotes with no local
 * twin here (the ahead/behind case), then the read-only decorations. Ties fall
 * back to the name, so a row keeps the same shape across refreshes.
 */
function compareChips(a: RefChip, b: RefChip): number {
  const byKind = (KIND_RANK[a.ref.kind] ?? 9) - (KIND_RANK[b.ref.kind] ?? 9);
  if (byKind !== 0) {
    return byKind;
  }
  if (a.ref.kind === "remote" && b.ref.kind === "remote") {
    const [rankA, remoteA] = remoteRank(a.ref.name);
    const [rankB, remoteB] = remoteRank(b.ref.name);
    if (rankA !== rankB) {
      return rankA - rankB;
    }
    if (remoteA !== remoteB) {
      return byCodepoint(remoteA, remoteB);
    }
  }
  return byCodepoint(a.ref.name, b.ref.name);
}

/** Same rule inside a merged chip: origin's block first, then the rest by name. */
function compareRemotes(a: CommitRef, b: CommitRef): number {
  const [rankA, remoteA] = remoteRank(a.name);
  const [rankB, remoteB] = remoteRank(b.name);
  return rankA - rankB || byCodepoint(remoteA, remoteB);
}

/**
 * Deterministic name tiebreak. `localeCompare` follows the runtime's default
 * collator, which differs between Node (tests) and WKWebView (the app) and
 * between users' systems — the same repo could paint rows in different orders.
 * Plain codepoint order is stable everywhere, and ref names are ASCII enough
 * that nothing linguistic is lost.
 */
function byCodepoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function isOriginHead(ref: CommitRef): boolean {
  return ref.kind === "remote" && splitRemoteRef(ref.name).branch === "HEAD";
}

function soloChip(ref: CommitRef): RefChip {
  return { key: `${ref.kind}:${ref.name}`, ref, remotes: [], remoteNames: [], label: ref.name };
}

/** Re-derive the merged fields after a remote is folded into `chip`. */
function refreshMerged(chip: RefChip): void {
  chip.remoteNames = chip.remotes.map((remote) => splitRemoteRef(remote.name).remote);
  chip.label =
    chip.remoteNames.length === 0
      ? chip.ref.name
      : `${chip.ref.name} (${chip.remoteNames.join(", ")})`;
}

/**
 * Turn a commit's refs into the chips its row paints.
 *
 * `master`, `origin/master` and `origin/HEAD` on one commit is three chips of
 * near-identical information that pushes the commit message out of view, and it
 * splits the right-click menu in two (local actions on one chip, remote ones on
 * another). Merging folds the same-named remotes into the local chip so one
 * menu covers both; a remote with no local twin here — the ahead/behind case —
 * keeps its own `origin/…` chip on the commit it really points at, so nothing
 * about the divergence is lost. Pure so the rules stay testable without a repo.
 */
export function buildRefChips(refs: CommitRef[], options: RefChipOptions): RefChipRow {
  const kept = options.hideOriginHead ? refs.filter((ref) => !isOriginHead(ref)) : refs;

  const chips: RefChip[] = [];
  if (!options.mergeLocalRemote) {
    for (const ref of kept) {
      chips.push(soloChip(ref));
    }
  } else {
    // Git does not promise the local ref comes before its remote twin in the
    // decoration, so collect the local names first and hold back any remote
    // that arrives early — the merged chip then sits where the local ref is.
    const locals = new Set(
      kept.map(localBranchName).filter((name): name is string => name !== null),
    );
    const pending = new Map<string, CommitRef[]>();
    const merged = new Map<string, RefChip>();
    for (const ref of kept) {
      const local = localBranchName(ref);
      if (local !== null && !merged.has(local)) {
        const chip = soloChip(ref);
        chip.remotes = pending.get(local) ?? [];
        refreshMerged(chip);
        merged.set(local, chip);
        chips.push(chip);
        continue;
      }
      if (ref.kind === "remote") {
        const branch = splitRemoteRef(ref.name).branch;
        const target = merged.get(branch);
        if (target) {
          target.remotes.push(ref);
          refreshMerged(target);
          continue;
        }
        if (locals.has(branch)) {
          pending.set(branch, [...(pending.get(branch) ?? []), ref]);
          continue;
        }
      }
      chips.push(soloChip(ref));
    }
  }

  // Sorted after the folding, so a merged chip is ranked as the branch it is
  // rather than as whichever half of it git happened to list first.
  for (const chip of chips) {
    if (chip.remotes.length > 1) {
      chip.remotes.sort(compareRemotes);
      refreshMerged(chip);
    }
  }
  chips.sort(compareChips);

  const limit = options.collapseAfter;
  if (limit !== null && limit > 0 && chips.length > limit) {
    return { chips: chips.slice(0, limit), overflow: chips.slice(limit) };
  }
  return { chips, overflow: [] };
}
