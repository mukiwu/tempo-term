import { BRANCH_COLORS } from "./branchColors";

/**
 * Minimal shape the layout algorithm needs: an id and its parent ids. A full
 * `CommitNode` satisfies this structurally, but callers that only have a
 * flat commit list (e.g. the sidebar's compact history graph) don't need to
 * fabricate the rest of `CommitNode`'s fields to reuse this algorithm.
 */
export interface GraphLayoutCommit {
  hash: string;
  parents: string[];
}

/** Geometry used to turn lane/row indices into SVG coordinates. */
export interface GraphGeometry {
  laneWidth: number;
  rowHeight: number;
  paddingLeft: number;
  paddingTop: number;
  /** Lanes past this index collapse onto the last column to stay compact. */
  maxLane: number;
}

export const DEFAULT_GEOMETRY: GraphGeometry = {
  laneWidth: 14,
  rowHeight: 36,
  paddingLeft: 16,
  paddingTop: 20,
  maxLane: 5,
};

/** Where a single commit node sits in the graph. */
export interface CommitLayout {
  x: number;
  y: number;
  lane: number;
  index: number;
  /** Branch colour id — cycles per branch line, not per lane index. */
  colorIndex: number;
}

/** A parent→child link resolved to concrete coordinates for drawing. */
export interface GraphEdge {
  cx: number;
  cy: number;
  px: number;
  py: number;
  lane: number;
  childIndex: number;
  parentIndex: number;
  /** Branch colour id of the line (the branch side of a merge/branch bend). */
  colorIndex: number;
}

export interface GraphLayout {
  layouts: Record<string, CommitLayout>;
  edges: GraphEdge[];
}

/** Horizontal centre of a lane, clamping wide lanes onto the last column. */
export function laneX(lane: number, geometry: GraphGeometry): number {
  return (
    geometry.paddingLeft + Math.min(lane, geometry.maxLane) * geometry.laneWidth + 12
  );
}

/**
 * Assign each commit a lane and resolve parent links into drawable edges.
 *
 * Lanes are a deterministic track assignment driven by parent links: a lane
 * "waits" for a specific parent hash; when that parent is reached the lane
 * follows its first parent and any extra (merge) parents claim fresh lanes.
 * Freed lanes are reused so the graph stays compact instead of drifting right.
 *
 * Pure (no DOM, no React) so it can be unit tested in isolation.
 */
export function computeGraphLayout(
  commits: readonly GraphLayoutCommit[],
  geometry: GraphGeometry = DEFAULT_GEOMETRY,
  headHash?: string,
): GraphLayout {
  const layouts: Record<string, CommitLayout> = {};

  // Each slot holds the hash a lane is currently waiting for. An empty string
  // marks a freed lane that a new branch can reuse.
  const activeLanes: string[] = [];
  // Palette-relative colour per lane slot. A new branch line (every claim,
  // including reusing a freed slot) takes a colour not currently shown on any
  // other active lane, so concurrent lanes never share a colour — until more
  // than `BRANCH_COLORS.length` lanes are active at once, when the palette is
  // exhausted and a repeat is unavoidable. This is stronger than a plain
  // per-claim counter, whose value mod the palette length could wrap back onto
  // a still-active neighbour (e.g. a branch forking off the trunk landing on
  // the trunk's own colour).
  const laneColors: number[] = [];
  const colorCount = BRANCH_COLORS.length;
  // Where to start scanning for the next colour. Advancing it keeps colours
  // cycling in palette order when nothing forces a different pick, so adjacent
  // fresh branches still look distinct.
  let nextColor = 0;
  // Reused across every pickColor() call (cleared each time) so laying out a
  // large repo doesn't allocate a fresh Set per lane claim.
  const used = new Set<number>();
  const pickColor = (): number => {
    used.clear();
    for (let idx = 0; idx < activeLanes.length; idx++) {
      if (activeLanes[idx] !== "") {
        used.add(laneColors[idx]);
      }
    }
    for (let offset = 0; offset < colorCount; offset++) {
      const candidate = (nextColor + offset) % colorCount;
      if (!used.has(candidate)) {
        nextColor = candidate + 1;
        return candidate;
      }
    }
    // Every colour is on an active lane (more lanes than colours): fall back to
    // the running counter and accept the repeat.
    return nextColor++ % colorCount;
  };
  const claimLane = (): number => {
    // The slot being claimed is still "" while pickColor() runs, so it is
    // skipped there — a lane never counts its own (freed, stale) colour against
    // itself, and the fresh colour only avoids genuinely active neighbours.
    const free = activeLanes.indexOf("");
    if (free !== -1) {
      laneColors[free] = pickColor();
      return free;
    }
    activeLanes.push("");
    laneColors.push(pickColor());
    return activeLanes.length - 1;
  };

  // Reserve the leftmost lane for HEAD before anything claims it, so the branch
  // you are on runs down the left edge and the branches that merely have newer
  // commits bend out to the right. Without this, lane 0 goes to whatever commit
  // happens to be newest — often another branch entirely — and the line you
  // most want to follow is the one pushed aside. Only when HEAD is actually in
  // this page: seeding a hash that never arrives would strand an empty lane.
  if (headHash && commits.some((c) => c.hash === headHash)) {
    activeLanes.push(headHash);
    laneColors.push(pickColor());
  }

  commits.forEach((commit, index) => {
    const y = geometry.paddingTop + index * geometry.rowHeight;
    const existing = activeLanes.indexOf(commit.hash);
    const lane = existing !== -1 ? existing : claimLane();

    // Free any other lanes that were also waiting for this same commit (it is
    // the parent of more than one branch) so they can be reused.
    for (let idx = 0; idx < activeLanes.length; idx++) {
      if (idx !== lane && activeLanes[idx] === commit.hash) {
        activeLanes[idx] = "";
      }
    }

    // This lane now follows the first parent; extra parents claim their own
    // lanes. A root commit frees the lane.
    if (commit.parents.length > 0) {
      activeLanes[lane] = commit.parents[0];
      for (let idx = 1; idx < commit.parents.length; idx++) {
        activeLanes[claimLane()] = commit.parents[idx];
      }
    } else {
      activeLanes[lane] = "";
    }

    layouts[commit.hash] = {
      x: laneX(lane, geometry),
      y,
      lane,
      index,
      colorIndex: laneColors[lane] ?? 0,
    };
  });

  // Parents may be referenced by a hash of a different length than the keys in
  // `layouts` (short vs long), so resolve by prefix when there is no exact hit.
  const resolveParent = (parentHash: string): CommitLayout | undefined => {
    const exact = layouts[parentHash];
    if (exact) {
      return exact;
    }
    const key = Object.keys(layouts).find(
      (h) => h.startsWith(parentHash) || parentHash.startsWith(h),
    );
    return key ? layouts[key] : undefined;
  };

  const edges: GraphEdge[] = [];
  commits.forEach((commit, index) => {
    const child = layouts[commit.hash];
    if (!child) {
      return;
    }
    commit.parents.forEach((parentHash) => {
      const parent = resolveParent(parentHash);
      if (!parent) {
        return;
      }
      // Colour the line by its branch side: the endpoint on the higher lane.
      // For a merge bend that is the merged-in branch (parent); for a branch's
      // tail merging back to the trunk it is the branch commit (child). Keeps
      // merge lines off the trunk colour so the graph reads as multiple colours.
      const colorIndex =
        child.lane >= parent.lane ? child.colorIndex : parent.colorIndex;
      edges.push({
        cx: child.x,
        cy: child.y,
        px: parent.x,
        py: parent.y,
        lane: child.lane,
        childIndex: index,
        parentIndex: parent.index,
        colorIndex,
      });
    });
  });

  return { layouts, edges };
}

/**
 * Row index of `commits[index]`'s first parent within the same array. Null
 * if the commit has no parent, or its first parent isn't loaded in `commits`
 * yet (the caller should page in more history and retry).
 */
export function firstParentRowIndex(
  commits: readonly GraphLayoutCommit[],
  index: number,
): number | null {
  const parentHash = commits[index]?.parents[0];
  if (!parentHash) {
    return null;
  }
  // Try exact match first.
  let found = commits.findIndex((c) => c.hash === parentHash);
  if (found !== -1) {
    return found;
  }
  // Fall back to prefix matching.
  found = commits.findIndex(
    (c) => c.hash.startsWith(parentHash) || parentHash.startsWith(c.hash),
  );
  return found === -1 ? null : found;
}

/**
 * Row index of the one commit whose first-parent edge continues
 * `commits[index]`'s exact lane going up (newer) — the straight line in the
 * graph, not a merge-in bend. Null if `commits[index]` is the newest commit
 * on its lane.
 */
export function laneContinuationRowIndex(
  edges: readonly GraphEdge[],
  index: number,
): number | null {
  const edge = edges.find((e) => e.parentIndex === index && e.cx === e.px);
  return edge ? edge.childIndex : null;
}

/** SVG path data for one edge: a straight track, or a bend into the parent lane. */
export function edgePath(edge: GraphEdge, rowHeight: number): string {
  const { cx, cy, px, py } = edge;
  if (px === cx) {
    return `M ${cx} ${cy} L ${px} ${py}`;
  }
  const bend = Math.min(rowHeight, py - cy);
  if (px < cx) {
    // Branch tail merging back down to a lower lane (typically the trunk):
    // keep the line in the branch's own lane going straight down, and only
    // bend into the parent's lane in the last row, right at the parent node.
    // Bending immediately (as the merge-in case does) would run the branch's
    // colour straight down the parent's lane and paint over the trunk line.
    const ty = py - bend;
    return `M ${cx} ${cy} L ${cx} ${ty} C ${cx} ${ty + bend * 0.5}, ${px} ${py - bend * 0.5}, ${px} ${py}`;
  }
  // Merge-in: the parent is on a higher lane (the merged-in branch). Bend out
  // of the child node into that lane within the first row, then run a straight
  // vertical track down the branch's own lane to the parent.
  const by = cy + bend;
  return `M ${cx} ${cy} C ${cx} ${cy + bend * 0.5}, ${px} ${by - bend * 0.5}, ${px} ${by} L ${px} ${py}`;
}
