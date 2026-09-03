/**
 * The review-comment loop for one file's comparison: the draft being typed,
 * the saved comments, and pushing both into whichever editors are currently
 * showing that file.
 *
 * Shared by the single-file diff tab and each file of the concatenated
 * all-changes view. The store behind it is global and keyed by path + staged
 * + side + line, so a comment left in one surface shows up in the other, and
 * the batch send picks up every unsent comment wherever it was written.
 */

import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { useSettingsStore } from "@/stores/settingsStore";
import { useDiffCommentStore } from "./diffCommentStore";
import { reanchorComments } from "./commentPrompt";
import { diffSideView, type DiffViews } from "./diffViews";
import {
  setCommentsEffect,
  setDraftEffect,
  type CommentHandlers,
} from "./diffCommentsExtension";

interface DiffCommentsOptions {
  /** Absolute path of the file being compared. */
  path: string;
  staged: boolean;
  /** The editors showing this file, or null while they are being built. */
  viewsRef: MutableRefObject<DiffViews | null>;
  /** Bumped by the owner whenever those editors are rebuilt. */
  viewEpoch: number;
  labels: CommentHandlers["labels"];
}

interface DiffComments {
  /** Callbacks for the comment gutter, one set per side. */
  commentHandlers: (side: "a" | "b") => CommentHandlers;
  /**
   * Re-anchor this file's comments against freshly built editors, for lines
   * that moved while the documents were reloading. Call before letting the
   * push effect render them.
   */
  reanchorInto: (views: DiffViews) => void;
  /** True while a comment is being typed — the text is not saved yet. */
  draftOpen: boolean;
}

export function useDiffComments({
  path,
  staged,
  viewsRef,
  viewEpoch,
  labels,
}: DiffCommentsOptions): DiffComments {
  const allComments = useDiffCommentStore((s) => s.comments);
  const fileComments = useMemo(
    () => allComments.filter((c) => c.path === path && c.staged === staged),
    [allComments, path, staged],
  );
  const [draft, setDraft] = useState<{ side: "a" | "b"; line: number } | null>(null);
  // The draft's text lives in a ref (not state): the widget reads it back on
  // rebuild — view recreation, draft moved to another line — so typed text is
  // never lost, and keystrokes don't re-render the component.
  const draftBodyRef = useRef("");

  // Push the current comment set and draft into both editors whenever either
  // changes (or the editors were rebuilt). The extension renders from these
  // effects; the store stays the single source of truth.
  useEffect(() => {
    for (const side of ["a", "b"] as const) {
      const view = diffSideView(viewsRef.current, side);
      if (!view) {
        continue;
      }
      view.dispatch({
        effects: [
          setCommentsEffect.of(
            fileComments
              .filter((c) => c.side === side)
              .map(({ id, line, body, sent }) => ({ id, line, body, sent })),
          ),
          setDraftEffect.of(draft && draft.side === side ? draft.line : null),
        ],
      });
    }
  }, [fileComments, draft, viewEpoch, viewsRef]);

  function commentHandlers(side: "a" | "b"): CommentHandlers {
    return {
      // Clicking another line moves the draft there, carrying its text —
      // never silently saving and never discarding what was typed.
      onAdd: (line) => {
        useSettingsStore.getState().setDiffCommentHintSeen(true);
        setDraft({ side, line });
      },
      onSave: (line, body) => {
        const view = diffSideView(viewsRef.current, side);
        const clamped = view ? Math.max(1, Math.min(line, view.state.doc.lines)) : line;
        const lineText = view ? view.state.doc.line(clamped).text : "";
        useDiffCommentStore.getState().add({ path, staged, side, line: clamped, lineText, body });
        draftBodyRef.current = "";
        setDraft(null);
      },
      onCancel: () => {
        draftBodyRef.current = "";
        setDraft(null);
      },
      onDelete: (id) => useDiffCommentStore.getState().remove(id),
      getDraftBody: () => draftBodyRef.current,
      onDraftChange: (text) => {
        draftBodyRef.current = text;
      },
      labels,
    };
  }

  function reanchorInto(views: DiffViews) {
    const store = useDiffCommentStore.getState();
    for (const side of ["a", "b"] as const) {
      const view = diffSideView(views, side);
      if (!view) {
        continue;
      }
      const doc = view.state.doc.toString().split("\n");
      const sideComments = store.comments.filter(
        (c) => c.path === path && c.staged === staged && c.side === side,
      );
      store.reanchor(reanchorComments(sideComments, doc));
    }
  }

  return { commentHandlers, reanchorInto, draftOpen: draft !== null };
}

/**
 * How many comments are waiting to be sent, across every file. Drives the
 * badge on the send button, which batches all of them in one go.
 */
export function useUnsentCommentCount(): number {
  return useDiffCommentStore((s) => s.comments.filter((c) => !c.sent).length);
}
