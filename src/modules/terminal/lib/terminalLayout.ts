/**
 * A recursive binary split tree for the terminal area. Each leaf is one
 * terminal pane; a split holds two children side by side ("row" = left/right)
 * or stacked ("col" = top/bottom) with a size ratio. All operations return new
 * trees (immutable) so React state updates stay predictable.
 */

export type SplitDirection = "row" | "col";

/**
 * What a leaf pane shows: a terminal, an open file, a note, a preview, the git
 * graph, a file's uncommitted diff, the AI sessions browser, or the launcher
 * (a freshly split pane that hasn't been chosen yet).
 */
export type PaneContent =
  | { kind: "terminal"; cwd?: string; ssh?: { connectionId: string } }
  | { kind: "editor"; path: string }
  | { kind: "note"; noteId: string }
  | { kind: "preview"; url: string }
  | { kind: "git-graph" }
  | { kind: "diff"; path: string; staged: boolean }
  | { kind: "sessions" }
  | { kind: "launcher" };

export const TERMINAL_PANE: PaneContent = { kind: "terminal" };

/**
 * Where a terminal pane should spawn. A pane's own saved cwd (restored from a
 * previous session) wins, then the explorer root, then the tab's initial cwd.
 * Empty values are skipped; returns undefined when nothing is set.
 */
export function resolveTerminalCwd(
  paneCwd: string | undefined,
  rootPath: string | null | undefined,
  tabCwd: string | undefined,
): string | undefined {
  return paneCwd || rootPath || tabCwd || undefined;
}

export type LayoutNode =
  | { kind: "leaf"; id: string; pane?: PaneContent }
  | {
      kind: "split";
      direction: SplitDirection;
      children: [LayoutNode, LayoutNode];
      sizes: [number, number];
    };

export function leaf(id: string, pane: PaneContent = TERMINAL_PANE): LayoutNode {
  return { kind: "leaf", id, pane };
}

/**
 * A leaf's content, defaulting to a terminal — trees persisted before mixed
 * panes existed have no `pane` field.
 */
/** Find a leaf's content by id anywhere in the tree, or undefined if absent. */
export function findPaneContent(node: LayoutNode, leafId: string): PaneContent | undefined {
  if (node.kind === "leaf") {
    return node.id === leafId ? paneOf(node) : undefined;
  }
  return findPaneContent(node.children[0], leafId) ?? findPaneContent(node.children[1], leafId);
}

export function paneOf(node: Extract<LayoutNode, { kind: "leaf" }>): PaneContent {
  return node.pane ?? TERMINAL_PANE;
}

/**
 * Replace the target leaf with a split of [target, newLeaf]. The new leaf shows
 * `newPane` (a terminal by default), so a split can mix terminals and files.
 */
export function splitLeaf(
  node: LayoutNode,
  targetId: string,
  direction: SplitDirection,
  newId: string,
  newPane: PaneContent = TERMINAL_PANE,
  anchor: "before" | "after" = "after",
): LayoutNode {
  if (node.kind === "leaf") {
    if (node.id !== targetId) {
      return node;
    }
    const existing = leaf(targetId, paneOf(node));
    const added = leaf(newId, newPane);
    return {
      kind: "split",
      direction,
      children: anchor === "before" ? [added, existing] : [existing, added],
      sizes: [0.5, 0.5],
    };
  }
  return {
    ...node,
    children: [
      splitLeaf(node.children[0], targetId, direction, newId, newPane, anchor),
      splitLeaf(node.children[1], targetId, direction, newId, newPane, anchor),
    ],
  };
}

/**
 * Wrap the whole tree as one side of a brand-new top-level split, with the
 * new pane on the other side. Used for the outer-edge drop zone, which adds
 * an entirely new column/row alongside everything else rather than carving
 * up any single existing pane.
 */
export function wrapTree(
  tree: LayoutNode,
  newId: string,
  newPane: PaneContent,
  direction: SplitDirection,
  anchor: "before" | "after",
): LayoutNode {
  const added = leaf(newId, newPane);
  return {
    kind: "split",
    direction,
    children: anchor === "before" ? [added, tree] : [tree, added],
    sizes: [0.5, 0.5],
  };
}

/** Replace one leaf's content in place (used when dropping a file onto a pane). */
export function setLeafPane(
  node: LayoutNode,
  leafId: string,
  pane: PaneContent,
): LayoutNode {
  if (node.kind === "leaf") {
    return node.id === leafId ? { ...node, pane } : node;
  }
  return {
    ...node,
    children: [
      setLeafPane(node.children[0], leafId, pane),
      setLeafPane(node.children[1], leafId, pane),
    ],
  };
}

/** Remove a leaf, collapsing its parent split onto the surviving sibling. */
export function removeLeaf(node: LayoutNode, targetId: string): LayoutNode | null {
  if (node.kind === "leaf") {
    return node.id === targetId ? null : node;
  }
  const a = removeLeaf(node.children[0], targetId);
  const b = removeLeaf(node.children[1], targetId);
  if (a === null) {
    return b;
  }
  if (b === null) {
    return a;
  }
  return { ...node, children: [a, b] };
}

/** Adjust the size ratio of the split that owns `targetId` as its first child. */
export function setSizes(
  node: LayoutNode,
  splitFirstChildPredicate: (n: LayoutNode) => boolean,
  sizes: [number, number],
): LayoutNode {
  if (node.kind === "leaf") {
    return node;
  }
  if (splitFirstChildPredicate(node)) {
    return { ...node, sizes };
  }
  return {
    ...node,
    children: [
      setSizes(node.children[0], splitFirstChildPredicate, sizes),
      setSizes(node.children[1], splitFirstChildPredicate, sizes),
    ],
  };
}

export function leafIds(node: LayoutNode): string[] {
  if (node.kind === "leaf") {
    return [node.id];
  }
  return [...leafIds(node.children[0]), ...leafIds(node.children[1])];
}

/**
 * A stable identifier for a split: the sorted ids of every leaf it contains.
 * Different splits never share the same leaf set, and it survives tree
 * restructuring without needing ids baked into the persisted tree.
 */
export function splitId(node: LayoutNode): string {
  return leafIds(node).slice().sort().join("|");
}

/** Adjust a split's size ratio, locating the split by its leaf-id signature. */
export function setSizesById(
  node: LayoutNode,
  id: string,
  sizes: [number, number],
): LayoutNode {
  if (node.kind === "leaf") {
    return node;
  }
  if (splitId(node) === id) {
    return { ...node, sizes };
  }
  return {
    ...node,
    children: [
      setSizesById(node.children[0], id, sizes),
      setSizesById(node.children[1], id, sizes),
    ],
  };
}

export function firstLeafId(node: LayoutNode | null): string | null {
  if (!node) {
    return null;
  }
  return node.kind === "leaf" ? node.id : firstLeafId(node.children[0]);
}

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PaneRect {
  id: string;
  rect: Rect;
  content: PaneContent;
}

/**
 * Where a drop lands relative to the pane it's over. `center` keeps the
 * pane's own drop behavior (unchanged from before Phase 4). `split` always
 * needs a fresh leaf id from the caller: `scope: "individual"` splits just
 * the hovered pane (only it moves); `scope: "outer"` wraps the *whole* tree
 * as one side of a brand-new top-level split, so every existing pane shifts
 * over together instead of any single pane being carved up.
 */
export type DropZone =
  | { kind: "center" }
  | {
      kind: "split";
      scope: "individual" | "outer";
      direction: SplitDirection;
      anchor: "before" | "after";
    };

export interface DropZoneInput {
  /** The percentage rect (from `computeLayout`) of the pane under the pointer. */
  paneRect: Rect;
  /** The tab's root split direction, or null when the tab is a single leaf. */
  rootDirection: SplitDirection | null;
  /** Pointer position in the same 0-100 percentage space as `paneRect`. */
  pointerXPct: number;
  pointerYPct: number;
  /** True when the dragged source is a folder — disables every edge/outer zone. */
  isFolder: boolean;
}

/** Single-pane tabs: how close to the left/right edge (as % of the pane, which fills the container) counts as a split zone. */
const SINGLE_PANE_EDGE_PCT = 33;
/** Multi-pane tabs: how close to a pane's own perpendicular edge counts as an individual split zone. */
const INDIVIDUAL_EDGE_PCT = 25;
/** Multi-pane tabs: how close to the whole container's along-axis edge counts as the outer insert zone. */
const OUTER_BAND_PCT = 12;

interface DropZoneCandidate {
  /** Percentage-point distance to the edge line — comparable across zones because both paneRect and the container share the same 0-100 space. */
  distancePct: number;
  zone: DropZone;
}

function nearestZone(candidates: DropZoneCandidate[]): DropZone {
  if (candidates.length === 0) {
    return { kind: "center" };
  }
  return candidates.reduce((best, c) => (c.distancePct < best.distancePct ? c : best)).zone;
}

/**
 * Resolve a drop position into a zone. See spec section C for the full rule
 * table; this implements it directly: single-pane tabs only ever offer
 * left/right (never top/bottom); multi-pane tabs layer an individual
 * per-pane edge (perpendicular to the root direction) under a whole-area
 * outer band (along the root direction), rotating 90 degrees when the root
 * is `"col"`. A corner where two zones would both qualify resolves to
 * whichever edge line the pointer is numerically closer to.
 */
export function resolveDropZone(input: DropZoneInput): DropZone {
  const { paneRect, rootDirection, pointerXPct, pointerYPct, isFolder } = input;
  if (isFolder) {
    return { kind: "center" };
  }

  if (rootDirection === null) {
    const leftDist = pointerXPct - paneRect.left;
    const rightDist = paneRect.left + paneRect.width - pointerXPct;
    const candidates: DropZoneCandidate[] = [];
    if (leftDist <= SINGLE_PANE_EDGE_PCT) {
      candidates.push({
        distancePct: leftDist,
        zone: { kind: "split", scope: "individual", direction: "row", anchor: "before" },
      });
    }
    if (rightDist <= SINGLE_PANE_EDGE_PCT) {
      candidates.push({
        distancePct: rightDist,
        zone: { kind: "split", scope: "individual", direction: "row", anchor: "after" },
      });
    }
    return nearestZone(candidates);
  }

  const rowOriented = rootDirection === "row";
  const candidates: DropZoneCandidate[] = [];

  const outerPointerPct = rowOriented ? pointerXPct : pointerYPct;
  const outerBeforeDist = outerPointerPct;
  const outerAfterDist = 100 - outerPointerPct;
  if (outerBeforeDist <= OUTER_BAND_PCT) {
    candidates.push({
      distancePct: outerBeforeDist,
      zone: { kind: "split", scope: "outer", direction: rootDirection, anchor: "before" },
    });
  }
  if (outerAfterDist <= OUTER_BAND_PCT) {
    candidates.push({
      distancePct: outerAfterDist,
      zone: { kind: "split", scope: "outer", direction: rootDirection, anchor: "after" },
    });
  }

  const individualDirection: SplitDirection = rowOriented ? "col" : "row";
  const paneStart = rowOriented ? paneRect.top : paneRect.left;
  const paneSpan = rowOriented ? paneRect.height : paneRect.width;
  const pointerOnAxis = rowOriented ? pointerYPct : pointerXPct;
  const individualBeforeDist = pointerOnAxis - paneStart;
  const individualAfterDist = paneStart + paneSpan - pointerOnAxis;
  // Relative to this pane's own span, not the whole container — a stacked
  // pane's span can be as little as 50, and an absolute threshold that large
  // would swallow its entire center, making it impossible to ever drop there.
  const individualThreshold = paneSpan * (INDIVIDUAL_EDGE_PCT / 100);
  if (individualBeforeDist <= individualThreshold) {
    candidates.push({
      distancePct: individualBeforeDist,
      zone: { kind: "split", scope: "individual", direction: individualDirection, anchor: "before" },
    });
  }
  if (individualAfterDist <= individualThreshold) {
    candidates.push({
      distancePct: individualAfterDist,
      zone: { kind: "split", scope: "individual", direction: individualDirection, anchor: "after" },
    });
  }

  return nearestZone(candidates);
}

const FULL: Rect = { left: 0, top: 0, width: 100, height: 100 };

/**
 * Flatten the tree into absolute pane rectangles (percentages). Rendering panes
 * from a flat list with stable keys keeps each terminal mounted when the tree
 * restructures, so splitting never kills an existing session.
 */
export function computeLayout(node: LayoutNode, rect: Rect = FULL): PaneRect[] {
  if (node.kind === "leaf") {
    return [{ id: node.id, rect, content: paneOf(node) }];
  }
  const total = node.sizes[0] + node.sizes[1];
  const fraction = node.sizes[0] / total;
  if (node.direction === "row") {
    const w0 = rect.width * fraction;
    return [
      ...computeLayout(node.children[0], { ...rect, width: w0 }),
      ...computeLayout(node.children[1], {
        left: rect.left + w0,
        top: rect.top,
        width: rect.width - w0,
        height: rect.height,
      }),
    ];
  }
  const h0 = rect.height * fraction;
  return [
    ...computeLayout(node.children[0], { ...rect, height: h0 }),
    ...computeLayout(node.children[1], {
      left: rect.left,
      top: rect.top + h0,
      width: rect.width,
      height: rect.height - h0,
    }),
  ];
}

/**
 * The id of the pane covering a point given in layout percentages (0–100), or
 * null if the point is outside every pane. Lets a drop resolve its target from
 * coordinates alone, without elementFromPoint (unreliable mid-drag in WKWebView).
 */
export function paneIdAt(panes: PaneRect[], xPct: number, yPct: number): string | null {
  const pane = panes.find(
    (p) =>
      xPct >= p.rect.left &&
      xPct <= p.rect.left + p.rect.width &&
      yPct >= p.rect.top &&
      yPct <= p.rect.top + p.rect.height,
  );
  return pane?.id ?? null;
}

export interface SplitterInfo {
  /** Matches setSizesById's id, so a drag can target this exact split. */
  id: string;
  direction: SplitDirection;
  /** The split's whole area, in percentages. */
  rect: Rect;
  /** Current fraction taken by the first child (left/top). */
  fraction: number;
}

/**
 * Collect every split's divider as a draggable handle descriptor: where the
 * split lives, which way it divides, and its current ratio.
 */
export function computeSplitters(node: LayoutNode, rect: Rect = FULL): SplitterInfo[] {
  if (node.kind === "leaf") {
    return [];
  }
  const total = node.sizes[0] + node.sizes[1];
  const fraction = node.sizes[0] / total;
  const here: SplitterInfo = { id: splitId(node), direction: node.direction, rect, fraction };
  if (node.direction === "row") {
    const w0 = rect.width * fraction;
    return [
      here,
      ...computeSplitters(node.children[0], { ...rect, width: w0 }),
      ...computeSplitters(node.children[1], {
        left: rect.left + w0,
        top: rect.top,
        width: rect.width - w0,
        height: rect.height,
      }),
    ];
  }
  const h0 = rect.height * fraction;
  return [
    here,
    ...computeSplitters(node.children[0], { ...rect, height: h0 }),
    ...computeSplitters(node.children[1], {
      left: rect.left,
      top: rect.top + h0,
      width: rect.width,
      height: rect.height - h0,
    }),
  ];
}

/** One pane in add-order, paired with its content, for `gridLayout`. */
export interface OrderedPane {
  id: string;
  content: PaneContent;
}

/**
 * Arrange 1-8 panes into a fixed grid: up to 4 equal-width columns, each
 * holding up to 2 equal-height stacked panes. `panes[0..3]` each get their
 * own column; `panes[4..7]` stack under columns 0-3 respectively. The caller
 * must cap input at 8 entries — this function does not validate or throw
 * on more.
 */
export function gridLayout(panes: OrderedPane[]): LayoutNode {
  const columnCount = Math.min(panes.length, 4);
  const columns: LayoutNode[] = [];
  for (let col = 0; col < columnCount; col++) {
    const bottomIndex = col + 4;
    if (bottomIndex < panes.length) {
      columns.push({
        kind: "split",
        direction: "col",
        children: [
          leaf(panes[col].id, panes[col].content),
          leaf(panes[bottomIndex].id, panes[bottomIndex].content),
        ],
        sizes: [0.5, 0.5],
      });
    } else {
      columns.push(leaf(panes[col].id, panes[col].content));
    }
  }
  return combineEqualRow(columns);
}

/** Nest `nodes` left to right as equal-width row splits ([1/n, (n-1)/n] at
 * each level, so `computeLayout` gives every node the same width). */
function combineEqualRow(nodes: LayoutNode[]): LayoutNode {
  if (nodes.length === 0) {
    throw new Error("combineEqualRow requires at least one node");
  }
  if (nodes.length === 1) {
    return nodes[0];
  }
  const [first, ...rest] = nodes;
  return {
    kind: "split",
    direction: "row",
    children: [first, combineEqualRow(rest)],
    sizes: [1 / nodes.length, (nodes.length - 1) / nodes.length],
  };
}
