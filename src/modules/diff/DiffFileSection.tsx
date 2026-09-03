import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight } from "lucide-react";
import { gitFileAtRev } from "@/modules/source-control/lib/gitBridge";
import { fsReadFile } from "@/modules/explorer/lib/fsBridge";
import { STATUS_COLOR } from "@/modules/source-control/lib/fileStatus";
import { selectTerminalFontFamily, useFontStore } from "@/stores/fontStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { changedLines, estimatedRows, type FileDiffStats } from "./lib/parseDiffStats";
import {
  buildDiffViews,
  collapseDiffRegion,
  destroyDiffViews,
  diffSideView,
  type DiffViews,
} from "./lib/diffViews";
import { useDiffComments } from "./lib/useDiffComments";
import { linkHorizontalScroll } from "./lib/linkScroll";

/** One changed file in the working tree, as the scan describes it. */
export interface ChangedFile {
  /**
   * Unique across both groups — a file that is staged AND edited again since
   * appears once in each, as two independent comparisons.
   */
  key: string;
  /** Repo-relative path, with git's forward slashes. */
  rel: string;
  /** Absolute path: the working copy to read, and the grammar to load. */
  path: string;
  /** true = HEAD vs index. false = index vs working tree. */
  staged: boolean;
  /** git's status letter: M, A, D, R, ?. */
  status: string;
  /** From the scan, or null for a file `git diff` never reports (untracked). */
  stats: FileDiffStats | null;
}

/** What a mounted section can answer about where its lines sit. */
export interface DiffSectionHandle {
  /**
   * Offset of `line` of the new document within `container`'s scrollable
   * content, or null when the editors are not up yet.
   */
  lineOffset: (container: HTMLElement, line: number) => number | null;
}

/**
 * A file changing more lines than this opens folded: a lock file, a generated
 * file or a reformatted one would otherwise take the whole page, and the
 * reader came here for everything else.
 */
export const TRUNCATE_CHANGED_LINES = 500;

interface DiffFileSectionProps {
  file: ChangedFile;
  repo: string;
  /** The viewport window says this file's editors should exist. */
  mount: boolean;
  /** The reader asked a folded file to open anyway. */
  expanded: boolean;
  onExpand: () => void;
  /** The reader closed this file by hand, having read it. */
  collapsed: boolean;
  onToggleCollapse: () => void;
  /** Height to hold while unmounted: measured once, estimated before that. */
  reserved: number;
  onMeasure: (key: string, height: number) => void;
  onHandle: (key: string, handle: DiffSectionHandle | null) => void;
  /** Report what a file the scan could not measure turned out to weigh. */
  onCounted: (key: string, counts: { added: number; deleted: number }) => void;
  /** A section with a comment half-typed is not unmounted under the reader. */
  onDraft: (key: string, open: boolean) => void;
  /** Bumped by the page when the working tree may have moved under it. */
  reloadKey: number;
  /** The pane is too narrow to carry explanations as well as actions. */
  narrow: boolean;
}

interface DiffDocs {
  left: string;
  right: string;
}

function lineCount(text: string): number {
  if (!text) {
    return 0;
  }
  const lines = text.split("\n");
  return text.endsWith("\n") ? lines.length - 1 : lines.length;
}

/**
 * One file's comparison inside the all-changes view: a header that reads
 * without the editors being up, and the same side-by-side (or inline) diff the
 * single-file tab shows, built only while the file is near the viewport.
 */
export function DiffFileSection({
  file,
  repo,
  mount,
  expanded,
  onExpand,
  collapsed,
  onToggleCollapse,
  reserved,
  onMeasure,
  onHandle,
  onCounted,
  onDraft,
  narrow,
  reloadKey,
}: DiffFileSectionProps) {
  const { t } = useTranslation("sourceControl");
  const hostRef = useRef<HTMLDivElement>(null);
  const viewsRef = useRef<DiffViews | null>(null);
  const fontFamily = useFontStore(selectTerminalFontFamily);
  const fontSize = useFontStore((s) => s.fontSize);
  const themeId = useSettingsStore((s) => s.themeId);
  const wordWrap = useSettingsStore((s) => s.wordWrap);
  const unified = useSettingsStore((s) => s.diffUnified);
  const [docs, setDocs] = useState<DiffDocs | null>(null);
  const [error, setError] = useState(false);
  const [viewEpoch, setViewEpoch] = useState(0);

  const binary = file.stats?.binary ?? false;
  // Changed lines decide whether the file opens folded. The scan knows for
  // every file git reports; an untracked one is only measurable once its
  // documents are in hand, which is fine — the fold happens before any editor
  // is built either way.
  const changed = file.stats
    ? changedLines(file.stats)
    : docs
      ? lineCount(docs.left) + lineCount(docs.right)
      : null;
  const folded = changed !== null && changed > TRUNCATE_CHANGED_LINES && !expanded;
  const closed = collapsed || folded;
  const hidden = binary || closed;
  // Nothing to read for a binary file, nothing to read for a file the reader
  // has closed, and nothing to read yet for one the scan already says is too
  // big.
  const shouldLoad = mount && !binary && !collapsed && !(file.stats !== null && folded);

  // One control for both ways a file is shut: an oversized file opens to its
  // full diff, anything else just opens back up.
  function toggleOpen() {
    if (folded) {
      onExpand();
      return;
    }
    onToggleCollapse();
  }

  const commentLabels = useMemo(
    () => ({
      add: t("diffCommentAdd"),
      placeholder: t("diffCommentPlaceholder"),
      save: t("diffCommentSave"),
      cancel: t("diffCommentCancel"),
      delete: t("diffCommentDelete"),
      sent: t("diffCommentSent"),
    }),
    [t],
  );
  const { commentHandlers, reanchorInto, draftOpen } = useDiffComments({
    path: file.path,
    staged: file.staged,
    viewsRef,
    viewEpoch,
    labels: commentLabels,
  });

  useEffect(() => {
    onDraft(file.key, draftOpen);
    return () => onDraft(file.key, false);
  }, [file.key, draftOpen, onDraft]);

  useEffect(() => {
    if (!shouldLoad) {
      return;
    }
    let cancelled = false;
    async function load() {
      try {
        const [left, right] = await Promise.all(
          file.staged
            ? [gitFileAtRev(repo, "HEAD", file.rel), gitFileAtRev(repo, ":", file.rel)]
            : [gitFileAtRev(repo, ":", file.rel), fsReadFile(file.path).catch(() => "")],
        );
        if (!cancelled) {
          setError(false);
          // Keep the previous object when nothing changed, so a re-read on
          // refocus doesn't tear the editors down and lose the reading
          // position.
          setDocs((prev) =>
            prev && prev.left === left && prev.right === right ? prev : { left, right },
          );
        }
      } catch {
        if (!cancelled) {
          setError(true);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [shouldLoad, repo, file.rel, file.path, file.staged, reloadKey]);

  // The old side is read through a ref so that folding a stretch back up
  // never lands in the dependencies of the effect that builds the editors.
  const docsRef = useRef<DiffDocs | null>(null);
  docsRef.current = docs;
  const collapseRegion = useCallback((side: "a" | "b", pos: number) => {
    const views = viewsRef.current;
    if (views) {
      collapseDiffRegion(views, side, pos, docsRef.current?.left ?? "");
    }
  }, []);

  useEffect(() => {
    const parent = hostRef.current;
    if (!docs || !parent || hidden || !mount) {
      return;
    }
    let views: DiffViews | null = null;
    let unlinkScroll: (() => void) | null = null;
    let cancelled = false;
    void buildDiffViews({
      parent,
      left: docs.left,
      right: docs.right,
      path: file.path,
      themeId,
      fontFamily,
      fontSize,
      wordWrap,
      unified,
      unchangedLines: t("diffUnchangedLines"),
      foldLabels: { fold: t("diffCollapseUnchanged"), unfold: t("diffExpandUnchanged") },
      onCollapseRegion: collapseRegion,
      commentHandlers,
      cancelled: () => cancelled,
    }).then((built) => {
      if (!built) {
        return;
      }
      views = built;
      viewsRef.current = built;
      if (built.kind === "split") {
        // Same as the single-file tab: reading a long line means dragging one
        // side and having the other follow, or the two halves stop lining up.
        unlinkScroll = linkHorizontalScroll(built.merge.a.scrollDOM, built.merge.b.scrollDOM);
      }
      reanchorInto(built);
      setViewEpoch((epoch) => epoch + 1);
      onMeasure(file.key, parent.offsetHeight);
    });
    return () => {
      cancelled = true;
      viewsRef.current = null;
      unlinkScroll?.();
      if (views) {
        destroyDiffViews(views);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- comment
    // callbacks and labels are rebuilt every render; rebuilding the editors
    // on those would throw away the reading position on every keystroke.
  }, [
    docs,
    hidden,
    mount,
    themeId,
    fontFamily,
    fontSize,
    wordWrap,
    unified,
    file.key,
    file.path,
  ]);

  // The height a section holds while unmounted has to keep up with what it
  // actually grew to — expanding a collapsed stretch changes it.
  useEffect(() => {
    const el = hostRef.current;
    if (!el || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(() => onMeasure(file.key, el.offsetHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, [file.key, onMeasure, docs, hidden, mount]);

  useEffect(() => {
    onHandle(file.key, {
      lineOffset: (container, line) => {
        const view = diffSideView(viewsRef.current, "b");
        if (!view) {
          return null;
        }
        const clamped = Math.max(1, Math.min(line, view.state.doc.lines));
        const block = view.lineBlockAt(view.state.doc.line(clamped).from);
        // documentTop is the document's top in screen coordinates, so this
        // holds whatever padding and collapsed bars sit above the line.
        const screenY = view.documentTop + block.top;
        return screenY - container.getBoundingClientRect().top + container.scrollTop;
      },
    });
    return () => onHandle(file.key, null);
  }, [file.key, onHandle, viewEpoch]);

  const added = file.stats ? file.stats.added : docs ? lineCount(docs.right) : null;
  const deleted = file.stats ? file.stats.deleted : docs ? lineCount(docs.left) : null;
  const slash = file.rel.lastIndexOf("/");
  const dir = slash < 0 ? "" : file.rel.slice(0, slash);
  const name = slash < 0 ? file.rel : file.rel.slice(slash + 1);
  // Before a file is measured, its placeholder is guessed from the hunks the
  // scan found — near enough that the scrollbar doesn't lurch when it mounts.
  const placeholder =
    reserved || (file.stats ? estimatedRows(file.stats) * Math.round(fontSize * 1.4) : 120);

  // A file the scan could not count — an untracked one — only learns its size
  // by loading. Report it up so the page total covers the whole change and not
  // just the tracked part of it.
  useEffect(() => {
    if (!file.stats && added !== null && deleted !== null) {
      onCounted(file.key, { added, deleted });
    }
  }, [file.key, file.stats, added, deleted, onCounted]);

  return (
    <section data-diff-file={file.key} className="border-b border-border">
      <header className="sticky top-0 z-10 flex h-7 items-center gap-2 border-b border-border bg-bg-elevated px-3">
        {/* The whole label opens and shuts the file, not just the chevron —
            same as the panel's folder rows (#381).

            The file's own name leads and the folder it sits in trails it,
            quieter and shrinking four times faster — reading a page of files
            is looking for the name, so the folder gives up its width first
            and the name only truncates once there is nothing else to give. */}
        <button
          type="button"
          onClick={toggleOpen}
          aria-expanded={!closed}
          aria-label={
            closed
              ? t("allChangesExpandFile", { name })
              : t("allChangesCollapseFile", { name })
          }
          className="flex min-w-0 flex-1 items-center gap-2 text-left text-fg-subtle hover:text-fg"
        >
          {closed ? (
            <ChevronRight size={13} className="shrink-0" />
          ) : (
            <ChevronDown size={13} className="shrink-0" />
          )}
          <span
            className={`w-3 shrink-0 text-center font-mono text-xs font-semibold ${
              STATUS_COLOR[file.status] ?? "text-fg-muted"
            }`}
          >
            {file.status}
          </span>
          <span className="min-w-0 truncate font-mono text-xs text-fg">{name}</span>
          {dir && (
            <span className="min-w-0 shrink-[4] truncate font-mono text-[11px] text-fg-subtle">
              {dir}
            </span>
          )}
        </button>
        {/* A file the reader did not shut says why it is shut anyway. It
            needs no button of its own: the header opens it, the same as every
            other file. On a narrow pane the reason steps out rather than
            truncate — half a sentence explains nothing. */}
        {folded && !collapsed && !narrow && (
          <span className="min-w-0 shrink-[4] truncate text-[11px] text-fg-subtle">
            {t("allChangesFolded", { count: TRUNCATE_CHANGED_LINES })}
          </span>
        )}
        {added !== null && deleted !== null && !binary && (
          <span className="ml-auto flex shrink-0 gap-2.5 font-mono text-[11px]">
            <span className="text-success">+{added}</span>
            <span className="text-danger">−{deleted}</span>
          </span>
        )}
      </header>
      {error ? (
        <p className="px-3 py-2 text-xs text-danger">{t("diffLoadError")}</p>
      ) : binary ? (
        <p className="px-3 py-2 text-xs text-fg-subtle">{t("allChangesBinary")}</p>
      ) : closed ? null : mount ? (
        <div
          ref={hostRef}
          style={docs ? undefined : { height: placeholder }}
          className={`diff-merge-view diff-flow ${unified ? "diff-inline-view" : ""}`}
        />
      ) : (
        <div style={{ height: placeholder }} />
      )}
    </section>
  );
}
