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
  /**
   * Lanes the gutter is sized for. Without `laneWidthMin` the lanes past this
   * collapse onto the last column; with it they narrow instead.
   */
  maxLane: number;
  /**
   * Narrowest a lane may get before the gutter itself has to widen. Leave it
   * unset to keep the collapsing behaviour — which is what a pane too narrow
   * to spend any width on lanes (the sidebar's inline history) wants.
   */
  laneWidthMin?: number;
   /**
   * Where the gutter stops growing. A repo really can have fifty branches live
   * at once, and no gutter wide enough to hold them leaves room for the rows
   * it is supposed to annotate. Past this the lanes are *not* stacked out of
   * sight — they keep their real position and simply run past the gutter,
   * where the caller draws them faded. The graph gives up the space, not the
   * truth: a couple of lanes over reads as a couple of faint tracks, fifty
   * over reads as the thicket it is.
   */
  maxColumns?: number;
}

/** Room kept to the right of the last lane, for the node and its ring. */
export const GUTTER_TRAIL = 24;

export const DEFAULT_GEOMETRY: GraphGeometry = {
  laneWidth: 14,
  rowHeight: 36,
  paddingLeft: 16,
  paddingTop: 20,
  maxLane: 5,
  laneWidthMin: 10,
  maxColumns: 20,
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
  /**
   * Both ends' lanes. `cx === px` cannot stand in for `lane === parentLane`:
   * `laneX` collapses every lane past `maxLane` onto one column.
   */
  lane: number;
  parentLane: number;
  childIndex: number;
  parentIndex: number;
  /** Branch colour id of the line (the branch side of a merge/branch bend). */
  colorIndex: number;
}

/** A line whose parent is not in this page, so it runs off the bottom. */
export interface OpenEnd {
  lane: number;
  x: number;
  y: number;
  /**
   * The child node's own x. A merge's extra parent waits on a lane of its
   * own, so the line has to leave the node before it can run down that lane —
   * without this it would start level with the node but a lane away from it.
   */
  childX: number;
  colorIndex: number;
  /** Row it leaves from; it always reaches the foot of the page. */
  childIndex: number;
}

export interface GraphLayout {
  layouts: Record<string, CommitLayout>;
  edges: GraphEdge[];
  /** Lines that leave the page rather than reaching a drawn parent. */
  openEnds: OpenEnd[];
  /** Lanes this layout actually uses. */
  lanes: number;
  /** Width each of them was given. */
  laneWidth: number;
  /** Total width the tracks need — what the caller should size its column to. */
  gutter: number;
  /** Lanes the gutter was sized for; a lane at or past this runs outside it. */
  columns: number;
}

export interface LaneSizing {
  laneWidth: number;
  gutter: number;
  /** Lanes the gutter was sized for; wider ones run past it. */
  columns: number;
}

/**
 * How wide each lane gets, and how much room they need altogether.
 *
 * The gutter is a fixed budget for as long as it can be: up to `maxLane + 1`
 * lanes take the full width, and past that the lanes narrow within the same
 * budget rather than the graph eating into the commit messages. Only once
 * they hit `laneWidthMin` — nine lanes still fit — does the gutter itself
 * grow. Without `laneWidthMin` there is no ladder: the caller has said it
 * would rather collapse the wide lanes than spend a pixel on them.
 */
export function laneSizing(lanes: number, geometry: GraphGeometry): LaneSizing {
  const budget =
    geometry.paddingLeft + (geometry.maxLane + 1) * geometry.laneWidth + GUTTER_TRAIL;
  if (geometry.laneWidthMin === undefined) {
    return {
      laneWidth: geometry.laneWidth,
      gutter: budget,
      columns: geometry.maxLane + 1,
    };
  }
  const columns = Math.min(lanes, geometry.maxColumns ?? lanes);
  const room = budget - geometry.paddingLeft - GUTTER_TRAIL;
  const laneWidth = Math.max(
    geometry.laneWidthMin,
    Math.min(geometry.laneWidth, Math.floor(room / Math.max(1, columns))),
  );
  return {
    laneWidth,
    columns,
    gutter: Math.max(budget, geometry.paddingLeft + columns * laneWidth + GUTTER_TRAIL),
  };
}

/**
 * Horizontal centre of a lane. `laneWidth` comes from `laneSizing` once the
 * whole page is laid out and its widest lane is known; the default is for
 * callers asking about a single lane in isolation, and lane 0 — the one they
 * ask about — sits at the same x under every width.
 */
export function laneX(lane: number, geometry: GraphGeometry, sizing?: LaneSizing): number {
  const width = sizing?.laneWidth ?? geometry.laneWidth;
  // Without a ladder the wide lanes collapse onto the last column, the way
  // they always have — that is what a pane too narrow to spend width on lanes
  // is asking for. With one, every lane keeps its true position; the ones past
  // the gutter are drawn outside it rather than stacked inside it.
  if (geometry.laneWidthMin === undefined) {
    return geometry.paddingLeft + Math.min(lane, geometry.maxLane) * width + 12;
  }
  return geometry.paddingLeft + lane * width + 12;
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
  let widest = 0;
  /** Every parent link, and the lane slot it was put on. */
  const waiting: { lane: number; row: number; parentHash: string }[] = [];

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
      waiting.push({ lane, row: index, parentHash: commit.parents[0] });
      for (let idx = 1; idx < commit.parents.length; idx++) {
        const extra = claimLane();
        activeLanes[extra] = commit.parents[idx];
        // Which lane is waiting for which parent, so a parent that never
        // arrives can still be drawn on the track that was reserved for it
        // rather than on its child's, where it would hide under the line to
        // the first parent.
        waiting.push({ lane: extra, row: index, parentHash: commit.parents[idx] });
      }
    } else {
      activeLanes[lane] = "";
    }

    layouts[commit.hash] = {
      // Filled in below: how wide a lane is depends on how many the page ends
      // up using, which is not known until every commit has claimed one.
      x: 0,
      y,
      lane,
      index,
      colorIndex: laneColors[lane] ?? 0,
    };
    if (lane > widest) {
      widest = lane;
    }
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

  // A lane held for a parent the page never reached carries a line but no
  // node, so counting only the nodes leaves it out — and then the column
  // ceiling clamps its line onto the last counted column, on top of a lane it
  // does not belong to. It needs a column of its own like any other.
  for (const link of waiting) {
    if (link.lane > widest && !resolveParent(link.parentHash)) {
      widest = link.lane;
    }
  }

  const lanes = widest + 1;
  const sizing = laneSizing(lanes, geometry);
  for (const layout of Object.values(layouts)) {
    layout.x = laneX(layout.lane, geometry, sizing);
  }

  const edges: GraphEdge[] = [];
  const openEnds: OpenEnd[] = [];
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
        parentLane: parent.lane,
        childIndex: index,
        parentIndex: parent.index,
        colorIndex,
      });
    });
  });

  // A parent the page never reached. The commit names it, so it exists; the
  // walk is closed under parents, so it is not somewhere else — it is further
  // down, past the last row loaded. Its lane goes on waiting for it, which
  // means the slot is never freed or reused, so a line straight down that lane
  // to the foot of the page is only drawing what the lane bookkeeping already
  // says. Where the parent actually sits is not needed to draw it, so this
  // costs no extra history.
  //
  // The caller decides whether to show them: once the walk is exhausted a
  // parent that still will not resolve is a shallow clone's graft boundary,
  // where the history really does stop and the line would be a lie.
  //
  // That test is all there is, and it only catches a graft at the end of the
  // walk. A graft reached with pages still to load draws a line to history
  // that will never arrive. Telling the two apart costs a call per unresolved
  // parent, which a page of them would spend on a case a terminal rarely
  // meets, so the seam is left open knowingly.
  for (const link of waiting) {
    if (resolveParent(link.parentHash)) {
      continue;
    }
    const child = layouts[commits[link.row].hash];
    if (!child) {
      continue;
    }
    openEnds.push({
      lane: link.lane,
      x: laneX(link.lane, geometry, sizing),
      y: child.y,
      childX: child.x,
      colorIndex: laneColors[link.lane] ?? 0,
      childIndex: link.row,
    });
  }

  return {
    layouts,
    edges,
    openEnds,
    lanes,
    laneWidth: sizing.laneWidth,
    gutter: sizing.gutter,
    columns: sizing.columns,
  };
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
  const edge = edges.find(
    (e) => e.parentIndex === index && e.lane === e.parentLane,
  );
  return edge ? edge.childIndex : null;
}

/** SVG path data for one edge: a straight track, or a bend into the parent lane. */
export function edgePath(edge: GraphEdge, rowHeight: number): string {
  const { cx, cy, px, py } = edge;
  if (edge.lane === edge.parentLane) {
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

/**
 * SVG path data for a line that leaves the page: out of its node, into the
 * lane held for the parent, and straight down to `footY`.
 *
 * Always the merge-in bend, in either direction, unlike `edgePath` — which
 * delays the bend when the parent is on a lower lane so a branch's colour does
 * not paint over the trunk it is rejoining. There is nothing to paint over
 * here: the lane is held for a parent that never arrives, so it stays empty
 * for the rest of the page, while the child's own lane is already carrying the
 * line to its first parent. Delaying the bend would run this line down that
 * one instead.
 */
export function openEndPath(end: OpenEnd, footY: number, rowHeight: number): string {
  const { x, y, childX } = end;
  if (childX === x) {
    return `M ${x} ${y} L ${x} ${footY}`;
  }
  // A node on the last row is half a row above the foot, so the bend takes
  // whatever room is left rather than overshooting it.
  const bend = Math.min(rowHeight, footY - y);
  const by = y + bend;
  return `M ${childX} ${y} C ${childX} ${y + bend * 0.5}, ${x} ${by - bend * 0.5}, ${x} ${by} L ${x} ${footY}`;
}
