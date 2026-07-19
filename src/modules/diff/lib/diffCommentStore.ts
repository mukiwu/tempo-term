import { create } from "zustand";

/** One review comment pinned to a line of a diff, destined for an agent. */
export interface DiffComment {
  id: string;
  /** Absolute path of the file the comment is on. */
  path: string;
  /** Which diff variant the comment was left in (staged vs working tree). */
  staged: boolean;
  /** "a" = old side (left editor), "b" = new side (right editor). */
  side: "a" | "b";
  /** 1-based line number in that side's document. */
  line: number;
  /** The line's text when the comment was created, used for re-anchoring. */
  lineText: string;
  body: string;
  /** Already delivered to an agent; kept visible for verification and skipped
   *  by the next batch. */
  sent: boolean;
}

interface DiffCommentState {
  comments: DiffComment[];
  add: (comment: Omit<DiffComment, "id" | "sent">) => void;
  remove: (id: string) => void;
  markSent: (ids: string[]) => void;
  /** Apply new line numbers after a reload re-anchored shifted comments. */
  reanchor: (updates: { id: string; line: number }[]) => void;
}

/** Session-only store — comments do not survive an app restart. */
export const useDiffCommentStore = create<DiffCommentState>((set) => ({
  comments: [],
  add: (comment) =>
    set((s) => ({
      comments: [...s.comments, { ...comment, id: crypto.randomUUID(), sent: false }],
    })),
  remove: (id) => set((s) => ({ comments: s.comments.filter((c) => c.id !== id) })),
  markSent: (ids) =>
    set((s) => ({
      comments: s.comments.map((c) => (ids.includes(c.id) ? { ...c, sent: true } : c)),
    })),
  reanchor: (updates) => {
    if (updates.length === 0) {
      return;
    }
    set((s) => ({
      comments: s.comments.map((c) => {
        const update = updates.find((u) => u.id === c.id);
        return update ? { ...c, line: update.line } : c;
      }),
    }));
  },
}));
