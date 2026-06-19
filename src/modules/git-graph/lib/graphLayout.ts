import type { CommitNode } from "../types";

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
  commits: readonly CommitNode[],
  geometry: GraphGeometry = DEFAULT_GEOMETRY,
): GraphLayout {
  const layouts: Record<string, CommitLayout> = {};

  // Each slot holds the hash a lane is currently waiting for. An empty string
  // marks a freed lane that a new branch can reuse.
  const activeLanes: string[] = [];
  // Colour id per lane slot. A new branch line (every claim, including reusing a
  // freed slot) takes the next colour so concurrent lanes never share a colour
  // and adjacent branches stay visually distinct, independent of lane index.
  const laneColors: number[] = [];
  let nextColor = 0;
  const claimLane = (): number => {
    const free = activeLanes.indexOf("");
    if (free !== -1) {
      laneColors[free] = nextColor++;
      return free;
    }
    activeLanes.push("");
    laneColors.push(nextColor++);
    return activeLanes.length - 1;
  };

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

/** SVG path data for one edge: a straight track, or a bend into the parent lane. */
export function edgePath(edge: GraphEdge, rowHeight: number): string {
  const { cx, cy, px, py } = edge;
  if (px === cx) {
    return `M ${cx} ${cy} L ${px} ${py}`;
  }
  // Bend out of the child node into the parent's lane within the first row,
  // then a straight vertical track down to the parent.
  const bend = Math.min(rowHeight, py - cy);
  const by = cy + bend;
  return `M ${cx} ${cy} C ${cx} ${cy + bend * 0.5}, ${px} ${by - bend * 0.5}, ${px} ${by} L ${px} ${py}`;
}
