/**
 * A recursive binary split tree for the terminal area. Each leaf is one
 * terminal pane; a split holds two children side by side ("row" = left/right)
 * or stacked ("col" = top/bottom) with a size ratio. All operations return new
 * trees (immutable) so React state updates stay predictable.
 */

export type SplitDirection = "row" | "col";

/** What a leaf pane shows: a terminal, an open file, a note, or a preview. */
export type PaneContent =
  | { kind: "terminal" }
  | { kind: "editor"; path: string }
  | { kind: "note"; noteId: string }
  | { kind: "preview"; url: string };

export const TERMINAL_PANE: PaneContent = { kind: "terminal" };

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
): LayoutNode {
  if (node.kind === "leaf") {
    if (node.id !== targetId) {
      return node;
    }
    return {
      kind: "split",
      direction,
      children: [leaf(targetId, paneOf(node)), leaf(newId, newPane)],
      sizes: [0.5, 0.5],
    };
  }
  return {
    ...node,
    children: [
      splitLeaf(node.children[0], targetId, direction, newId, newPane),
      splitLeaf(node.children[1], targetId, direction, newId, newPane),
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
