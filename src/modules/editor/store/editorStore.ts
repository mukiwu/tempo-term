import { create } from "zustand";

interface Buffer {
  content: string;
  baseline: string;
}

interface EditorState {
  buffers: Record<string, Buffer>;
  /** Set both content and baseline, marking the buffer clean (load or save). */
  setBaseline: (path: string, content: string) => void;
  /** Update the working content, leaving the baseline so dirty can be derived. */
  setContent: (path: string, content: string) => void;
  /** Reset the baseline to the current content after a successful save. */
  markSaved: (path: string) => void;
  /** Drop a buffer entirely, e.g. when its file is closed, so reopening the
   *  file reads fresh from disk instead of resurrecting discarded edits. */
  forget: (path: string) => void;
  isDirty: (path: string) => boolean;
  contentOf: (path: string) => string;
}

export const useEditorStore = create<EditorState>((set, get) => ({
  buffers: {},

  setBaseline: (path, content) =>
    set((state) => ({
      buffers: { ...state.buffers, [path]: { content, baseline: content } },
    })),

  setContent: (path, content) =>
    set((state) => {
      const existing = state.buffers[path];
      const baseline = existing ? existing.baseline : content;
      return {
        buffers: { ...state.buffers, [path]: { content, baseline } },
      };
    }),

  markSaved: (path) =>
    set((state) => {
      const existing = state.buffers[path];
      if (!existing) {
        return state;
      }
      return {
        buffers: {
          ...state.buffers,
          [path]: { content: existing.content, baseline: existing.content },
        },
      };
    }),

  forget: (path) =>
    set((state) => {
      if (!(path in state.buffers)) {
        return state;
      }
      const { [path]: _removed, ...rest } = state.buffers;
      return { buffers: rest };
    }),

  isDirty: (path) => {
    const buffer = get().buffers[path];
    return buffer ? buffer.content !== buffer.baseline : false;
  },

  contentOf: (path) => get().buffers[path]?.content ?? "",
}));
