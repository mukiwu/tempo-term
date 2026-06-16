import { create } from "zustand";
import {
  firstLeafId,
  leaf,
  removeLeaf,
  splitLeaf,
  type LayoutNode,
  type SplitDirection,
} from "../lib/terminalLayout";

interface TerminalSplitState {
  root: LayoutNode | null;
  activeLeafId: string | null;
  ensureInitial: () => void;
  splitActive: (direction: SplitDirection) => void;
  closeLeaf: (id: string) => void;
  setActive: (id: string) => void;
  setSizesAtPath: (path: number[], sizes: [number, number]) => void;
}

let counter = 0;
function nextPaneId(): string {
  counter += 1;
  return `pane-${counter}`;
}

/** Walk `node` by a path of child indices and set the target split's sizes. */
function updateSizes(
  node: LayoutNode,
  path: number[],
  sizes: [number, number],
): LayoutNode {
  if (node.kind === "leaf") {
    return node;
  }
  if (path.length === 0) {
    return { ...node, sizes };
  }
  const [head, ...rest] = path;
  const children: [LayoutNode, LayoutNode] = [node.children[0], node.children[1]];
  children[head] = updateSizes(children[head], rest, sizes);
  return { ...node, children };
}

export const useTerminalSplitStore = create<TerminalSplitState>((set, get) => ({
  root: null,
  activeLeafId: null,

  ensureInitial: () => {
    if (get().root) {
      return;
    }
    const id = nextPaneId();
    set({ root: leaf(id), activeLeafId: id });
  },

  splitActive: (direction) =>
    set((state) => {
      if (!state.root || !state.activeLeafId) {
        const id = nextPaneId();
        return { root: leaf(id), activeLeafId: id };
      }
      const newId = nextPaneId();
      return {
        root: splitLeaf(state.root, state.activeLeafId, direction, newId),
        activeLeafId: newId,
      };
    }),

  closeLeaf: (id) =>
    set((state) => {
      if (!state.root) {
        return state;
      }
      const root = removeLeaf(state.root, id);
      const activeLeafId =
        state.activeLeafId === id ? firstLeafId(root) : state.activeLeafId;
      return { root, activeLeafId };
    }),

  setActive: (id) => set({ activeLeafId: id }),

  setSizesAtPath: (path, sizes) =>
    set((state) => (state.root ? { root: updateSizes(state.root, path, sizes) } : state)),
}));
