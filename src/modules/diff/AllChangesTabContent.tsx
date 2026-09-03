import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  ChevronUp,
  Send,
  SquareSplitHorizontal,
  SquareSplitVertical,
  WrapText,
} from "lucide-react";
import { PaneHeader } from "@/components/PaneHeader";
import { Tooltip } from "@/components/Tooltip";
import { ContextMenu } from "@/components/ContextMenu";
import { gitDiff, gitResolveRepo, gitStatus } from "@/modules/source-control/lib/gitBridge";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { changedLines, parseDiffStats, type FileDiffStats } from "./lib/parseDiffStats";
import { agentTargetMenuItems } from "./lib/sendComments";
import { changeAtViewportTop } from "./lib/changeAtTop";
import { useUnsentCommentCount } from "./lib/useDiffComments";
import {
  DiffFileSection,
  TRUNCATE_CHANGED_LINES,
  type ChangedFile,
  type DiffSectionHandle,
} from "./DiffFileSection";

interface AllChangesTabContentProps {
  /** Show the shared pane close button (the tab is split). */
  showClose?: boolean;
  onClose?: () => void;
}

/**
 * How far outside the viewport a file's editors are kept alive. A MergeView is
 * a pair of full CodeMirror instances, so a repo with fifty changed files
 * cannot have them all up at once; a margin of about a screen either way means
 * the next file is ready before it is scrolled to.
 */
const MOUNT_MARGIN = "800px";

/** Breathing room above a change that navigation lands on. */
const LANDING_GAP = 8;

/**
 * Below this the header's numbers start costing the pane its own name, so the
 * two that repeat elsewhere give way: the file count is already on the panel's
 * Changes section, and "uncommitted" only matters next to a comparison that
 * isn't. The +/- total has nowhere else to be read, so it stays.
 */
const NARROW_PANE = 600;

interface FileCounts {
  added: number;
  deleted: number;
}

interface ChangedFiles {
  staged: ChangedFile[];
  unstaged: ChangedFile[];
}

function toChangedFile(
  repo: string,
  file: { path: string; status: string },
  staged: boolean,
  stats: Map<string, FileDiffStats>,
): ChangedFile {
  return {
    key: `${staged ? "s" : "w"}:${file.path}`,
    rel: file.path,
    path: `${repo}/${file.path}`,
    staged,
    status: file.status,
    stats: stats.get(file.path) ?? null,
  };
}

/**
 * Every uncommitted change in the repo as one scrolling page: each file the
 * same side-by-side comparison the single-file tab shows, stacked, with the
 * unchanged stretches folded away.
 *
 * Two things keep it affordable on a large working tree. The file list, the
 * +/- counts and the placeholder heights all come from one `git diff` scan,
 * which is cheap and needs no editors; and only the files near the viewport
 * have their editors built, the rest holding their place at the height the
 * scan predicts (or the height they last measured).
 */
export function AllChangesTabContent({ showClose = false, onClose }: AllChangesTabContentProps) {
  const { t } = useTranslation("sourceControl");
  const { t: tEditor } = useTranslation("editor");
  const rootPath = useWorkspaceStore((s) => s.rootPath);
  const wordWrap = useSettingsStore((s) => s.wordWrap);
  const toggleWordWrap = useSettingsStore((s) => s.toggleWordWrap);
  const unified = useSettingsStore((s) => s.diffUnified);
  const toggleUnified = useSettingsStore((s) => s.toggleDiffUnified);
  const unsent = useUnsentCommentCount();

  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(false);
  const [repo, setRepo] = useState<string | null>(null);
  const [resolved, setResolved] = useState(false);
  const [files, setFiles] = useState<ChangedFiles | null>(null);
  const [error, setError] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [sendMenu, setSendMenu] = useState<{ x: number; y: number } | null>(null);

  // Which files have their editors up, which oversized ones the reader opened
  // anyway, and the heights the mounted ones grew to.
  const [mounted, setMounted] = useState<ReadonlySet<string>>(() => new Set());
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  // Files the reader has shut by hand, having read them.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const heightsRef = useRef(new Map<string, number>());
  const elementsRef = useRef(new Map<string, HTMLElement>());
  const handlesRef = useRef(new Map<string, DiffSectionHandle>());
  const draftsRef = useRef(new Set<string>());
  // Bumped when a section's editors come or go, so a jump waiting on one can
  // finish.
  const [handleEpoch, setHandleEpoch] = useState(0);

  // A pane is not a window: it can be a quarter of one, so what fits in the
  // header follows the pane's own width rather than any viewport breakpoint.
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      setNarrow(width > 0 && width < NARROW_PANE);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Resolve the repo from the workspace root, the same way the Git Graph tab
  // does — this view is about the workspace, not about any one file.
  useEffect(() => {
    if (!rootPath) {
      setResolved(true);
      setRepo(null);
      return;
    }
    let cancelled = false;
    setResolved(false);
    gitResolveRepo(rootPath)
      .then((resolvedRepo) => {
        if (!cancelled) {
          setRepo(resolvedRepo);
          setResolved(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRepo(null);
          setResolved(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [rootPath]);

  // Re-scan when the window regains focus (e.g. after staging or committing
  // elsewhere); cheap enough that no file watcher is needed. The same key is
  // handed to every section, so the files already up re-read their own two
  // documents rather than keeping whatever they loaded first.
  useEffect(() => {
    const bump = () => setRefreshKey((key) => key + 1);
    window.addEventListener("focus", bump);
    return () => window.removeEventListener("focus", bump);
  }, []);

  useEffect(() => {
    if (!repo) {
      setFiles(null);
      return;
    }
    let cancelled = false;
    async function scan(repoPath: string) {
      try {
        // `gitDiff` compares one side or the other, never both, so the staged
        // and working-tree halves are two scans. The file list itself comes
        // from status: it is the same list the Source Control panel shows,
        // and unlike `git diff` it reports untracked files.
        const [status, stagedDiff, workingDiff] = await Promise.all([
          gitStatus(repoPath),
          gitDiff(repoPath, true),
          gitDiff(repoPath, false),
        ]);
        if (cancelled) {
          return;
        }
        const stagedStats = parseDiffStats(stagedDiff);
        const workingStats = parseDiffStats(workingDiff);
        setError(false);
        setFiles({
          staged: status.staged.map((file) => toChangedFile(repoPath, file, true, stagedStats)),
          unstaged: status.unstaged.map((file) =>
            toChangedFile(repoPath, file, false, workingStats),
          ),
        });
      } catch {
        if (!cancelled) {
          setError(true);
        }
      }
    }
    void scan(repo);
    return () => {
      cancelled = true;
    };
  }, [repo, refreshKey]);

  const ordered = useMemo(
    () => (files ? [...files.staged, ...files.unstaged] : []),
    [files],
  );

  // Mount the files near the viewport and let the rest hold their place.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || ordered.length === 0) {
      return;
    }
    elementsRef.current = new Map();
    for (const element of root.querySelectorAll<HTMLElement>("[data-diff-file]")) {
      const key = element.dataset.diffFile;
      if (key) {
        elementsRef.current.set(key, element);
      }
    }
    if (typeof IntersectionObserver === "undefined") {
      // No windowing available (jsdom): show everything rather than nothing.
      setMounted(new Set(ordered.map((file) => file.key)));
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        setMounted((prev) => {
          const next = new Set(prev);
          let changed = false;
          for (const entry of entries) {
            const key = (entry.target as HTMLElement).dataset.diffFile;
            if (!key) {
              continue;
            }
            if (entry.isIntersecting) {
              changed = !next.has(key) || changed;
              next.add(key);
              // A file that scrolled away while a comment was being typed
              // keeps its editors: tearing them down would take the draft
              // with them.
            } else if (!draftsRef.current.has(key) && next.delete(key)) {
              changed = true;
            }
          }
          return changed ? next : prev;
        });
      },
      { root, rootMargin: `${MOUNT_MARGIN} 0px` },
    );
    for (const element of elementsRef.current.values()) {
      observer.observe(element);
    }
    return () => observer.disconnect();
  }, [ordered]);

  const onMeasure = useCallback((key: string, height: number) => {
    if (height > 0) {
      heightsRef.current.set(key, height);
    }
  }, []);

  const onHandle = useCallback((key: string, handle: DiffSectionHandle | null) => {
    if (handle) {
      handlesRef.current.set(key, handle);
    } else {
      handlesRef.current.delete(key);
    }
    setHandleEpoch((epoch) => epoch + 1);
  }, []);

  const onDraft = useCallback((key: string, open: boolean) => {
    if (open) {
      draftsRef.current.add(key);
    } else {
      draftsRef.current.delete(key);
    }
  }, []);

  // What the scan could not measure, reported back by the sections that did.
  const [counted, setCounted] = useState<ReadonlyMap<string, FileCounts>>(() => new Map());
  const onCounted = useCallback((key: string, counts: FileCounts) => {
    setCounted((prev) => {
      const had = prev.get(key);
      if (had && had.added === counts.added && had.deleted === counts.deleted) {
        return prev;
      }
      return new Map(prev).set(key, counts);
    });
  }, []);

  /**
   * The whole change in two numbers. One of the reasons for this view is that
   * a list of file names never says how big the change actually is.
   */
  const totals = useMemo(() => {
    let added = 0;
    let deleted = 0;
    for (const file of ordered) {
      const counts = file.stats ?? counted.get(file.key);
      if (counts) {
        added += counts.added;
        deleted += counts.deleted;
      }
    }
    return { added, deleted };
  }, [ordered, counted]);

  const onExpand = useCallback((key: string) => {
    setExpanded((prev) => new Set(prev).add(key));
  }, []);

  const onToggleCollapse = useCallback((key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) {
        next.add(key);
      }
      return next;
    });
  }, []);

  /**
   * Every change in the page, in reading order. Built from the scan rather
   * than from the editors: the file a jump lands in may not be mounted yet,
   * so there is nothing to ask. A file left folded contributes nothing —
   * there is no line on screen to land on until it is opened.
   */
  const changes = useMemo(() => {
    const list: { key: string; line: number }[] = [];
    for (const file of ordered) {
      if (file.stats?.binary || collapsed.has(file.key)) {
        continue;
      }
      if (
        file.stats &&
        changedLines(file.stats) > TRUNCATE_CHANGED_LINES &&
        !expanded.has(file.key)
      ) {
        continue;
      }
      const hunks = file.stats?.hunks ?? [];
      if (hunks.length === 0) {
        // An untracked file has no hunks of its own: the whole file is the
        // change, and it starts at the top.
        list.push({ key: file.key, line: 1 });
        continue;
      }
      for (const hunk of hunks) {
        list.push({ key: file.key, line: hunk.line });
      }
    }
    return list;
  }, [ordered, expanded, collapsed]);

  const [position, setPosition] = useState(0);
  const [pending, setPending] = useState<{ key: string; line: number } | null>(null);

  /**
   * Where a change sits inside the page's scrollable content. A mounted file
   * can place its own line; one that is not up yet is placed at the top of its
   * section, which is close enough to count by and always available.
   */
  const changeTop = useCallback(
    (root: HTMLElement, index: number): number | null => {
      const change = changes[index];
      if (!change) {
        return null;
      }
      const placed = handlesRef.current.get(change.key)?.lineOffset(root, change.line) ?? null;
      if (placed !== null) {
        return placed;
      }
      const element = elementsRef.current.get(change.key);
      if (!element) {
        return null;
      }
      return (
        root.scrollTop + element.getBoundingClientRect().top - root.getBoundingClientRect().top
      );
    },
    [changes],
  );

  // The counter follows the page rather than only the buttons: scrolling by
  // hand, or being scrolled by a click in the Source Control panel, moves it
  // too, so prev/next always carries on from what is actually on screen.
  const scrollFrame = useRef(0);
  const trackPosition = useCallback(() => {
    // Cancel and re-schedule, rather than skipping while one is pending. A
    // frame that never runs -- requestAnimationFrame simply does not fire for
    // a minimised or hidden window -- would otherwise leave the pending id in
    // the ref and every later call returning on that first line, leaving the
    // counter dead until a reload. Still at most one frame in flight, but it
    // cannot wedge.
    if (scrollFrame.current) {
      cancelAnimationFrame(scrollFrame.current);
    }
    scrollFrame.current = requestAnimationFrame(() => {
      scrollFrame.current = 0;
      const root = scrollRef.current;
      if (!root) {
        return;
      }
      const top = root.scrollTop + LANDING_GAP + 4;
      setPosition(changeAtViewportTop(changes.length, top, (i) => changeTop(root, i)));
    });
  }, [changes.length, changeTop]);

  // Coming back to a window that was hidden brings no scroll event with it,
  // and no frame ran while it was away to take a reading, so one is taken on
  // the way in.
  useEffect(() => {
    const track = () => trackPosition();
    window.addEventListener("focus", track);
    document.addEventListener("visibilitychange", track);
    return () => {
      window.removeEventListener("focus", track);
      document.removeEventListener("visibilitychange", track);
    };
  }, [trackPosition]);

  useEffect(
    () => () => {
      if (scrollFrame.current) {
        cancelAnimationFrame(scrollFrame.current);
      }
    },
    [],
  );

  // A rescan can leave the counter past the end.
  useEffect(() => {
    setPosition((prev) => Math.min(prev, changes.length));
  }, [changes.length]);

  const jumpTo = useCallback((target: { key: string; line: number }) => {
    const root = scrollRef.current;
    if (!root) {
      return;
    }
    setMounted((prev) => (prev.has(target.key) ? prev : new Set(prev).add(target.key)));
    const offset = handlesRef.current.get(target.key)?.lineOffset(root, target.line) ?? null;
    if (offset !== null) {
      root.scrollTop = Math.max(0, offset - LANDING_GAP);
      return;
    }
    // The file's editors are not up yet. Put its header on screen so the jump
    // reads as movement, and finish it once they are.
    const element = elementsRef.current.get(target.key);
    if (element) {
      root.scrollTop = Math.max(
        0,
        root.scrollTop + element.getBoundingClientRect().top - root.getBoundingClientRect().top,
      );
    }
    setPending(target);
  }, []);

  useEffect(() => {
    if (!pending) {
      return;
    }
    const root = scrollRef.current;
    const offset = root
      ? (handlesRef.current.get(pending.key)?.lineOffset(root, pending.line) ?? null)
      : null;
    if (root && offset !== null) {
      root.scrollTop = Math.max(0, offset - LANDING_GAP);
      setPending(null);
    }
  }, [pending, handleEpoch]);

  function goToChange(direction: "prev" | "next") {
    if (changes.length === 0) {
      return;
    }
    const next =
      direction === "next"
        ? Math.min(position + 1, changes.length)
        : Math.max(position - 1, 1);
    setPosition(next);
    jumpTo(changes[next - 1]);
  }

  function renderGroup(group: ChangedFile[], label: string) {
    if (group.length === 0) {
      return null;
    }
    return (
      <>
        <h2 className="flex items-center gap-2 border-b border-border bg-bg px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
          {label}
          <span className="font-mono text-[11px] font-normal normal-case">{group.length}</span>
        </h2>
        {group.map((file) => (
          <DiffFileSection
            key={file.key}
            file={file}
            repo={repo ?? ""}
            mount={mounted.has(file.key)}
            expanded={expanded.has(file.key)}
            onExpand={() => onExpand(file.key)}
            collapsed={collapsed.has(file.key)}
            onToggleCollapse={() => onToggleCollapse(file.key)}
            reserved={heightsRef.current.get(file.key) ?? 0}
            onMeasure={onMeasure}
            onHandle={onHandle}
            onCounted={onCounted}
            onDraft={onDraft}
            narrow={narrow}
            reloadKey={refreshKey}
          />
        ))}
      </>
    );
  }

  const empty = files !== null && ordered.length === 0;

  return (
    <div ref={rootRef} className="relative flex h-full flex-col bg-bg">
      <PaneHeader
        left={
          // Clips its own content: the actions opposite never shrink, so
          // anything that overruns here would be painted over them.
          <div className="flex min-w-0 items-center gap-2 overflow-hidden">
            <span className="min-w-0 truncate text-xs text-fg-muted">{t("allChanges")}</span>
            {/* Named now so that comparing against another ref later reads as
                a different thing rather than a redefinition of this one. */}
            {!narrow && (
              <span className="shrink-0 text-xs text-fg-subtle">
                {t("allChangesUncommitted")}
              </span>
            )}
          </div>
        }
        actions={
          <>
            {ordered.length > 0 && (
              <span className="mr-1 flex shrink-0 items-center gap-2.5 font-mono text-[11px]">
                <span className="text-success">+{totals.added}</span>
                <span className="text-danger">−{totals.deleted}</span>
                {!narrow && (
                  <span className="text-fg-subtle">
                    {t("allChangesFileCount", { count: ordered.length })}
                  </span>
                )}
              </span>
            )}
            {changes.length > 0 && (
              <span className="mr-1 font-mono text-[11px] text-fg-subtle">
                {position}/{changes.length}
              </span>
            )}
            <Tooltip label={t("diffPrevChange")}>
              <button
                type="button"
                aria-label={t("diffPrevChange")}
                onClick={() => goToChange("prev")}
                className="rounded p-1 text-fg-muted hover:bg-bg-elevated hover:text-fg"
              >
                <ChevronUp size={14} />
              </button>
            </Tooltip>
            <Tooltip label={t("diffNextChange")}>
              <button
                type="button"
                aria-label={t("diffNextChange")}
                onClick={() => goToChange("next")}
                className="rounded p-1 text-fg-muted hover:bg-bg-elevated hover:text-fg"
              >
                <ChevronDown size={14} />
              </button>
            </Tooltip>
            {/* Names and draws the mode it switches to, not the one in use —
                a two-way switch, so there is no "pressed" state to show. */}
            <Tooltip label={unified ? t("diffSplitView") : t("diffInlineView")}>
              <button
                type="button"
                aria-label={unified ? t("diffSplitView") : t("diffInlineView")}
                onClick={toggleUnified}
                className="rounded p-1 text-fg-muted hover:bg-bg-elevated hover:text-fg"
              >
                {unified ? <SquareSplitHorizontal size={14} /> : <SquareSplitVertical size={14} />}
              </button>
            </Tooltip>
            <Tooltip label={tEditor("wrap")}>
              <button
                type="button"
                aria-label={tEditor("wrap")}
                aria-pressed={wordWrap}
                onClick={toggleWordWrap}
                className={`rounded p-1 ${
                  wordWrap
                    ? "bg-bg-elevated text-fg"
                    : "text-fg-muted hover:bg-bg-elevated hover:text-fg"
                }`}
              >
                <WrapText size={14} />
              </button>
            </Tooltip>
            <Tooltip label={t("diffSendToAgent")}>
              <button
                type="button"
                aria-label={t("diffSendToAgent")}
                disabled={unsent === 0}
                onClick={(event) => setSendMenu({ x: event.clientX, y: event.clientY })}
                className="flex items-center gap-1 rounded p-1 text-fg-muted hover:bg-bg-elevated hover:text-fg disabled:pointer-events-none disabled:opacity-40"
              >
                <Send size={14} />
                {unsent > 0 && (
                  <span className="font-mono text-[11px] leading-none">{unsent}</span>
                )}
              </button>
            </Tooltip>
          </>
        }
        showClose={showClose}
        onClose={() => onClose?.()}
      />
      {resolved && !repo ? (
        <p className="px-3 py-2 text-xs text-fg-subtle">{t("noRepo")}</p>
      ) : error ? (
        <p className="px-3 py-2 text-xs text-danger">{t("diffLoadError")}</p>
      ) : empty ? (
        <p className="px-3 py-2 text-xs text-fg-subtle">{t("noChanges")}</p>
      ) : (
        <div ref={scrollRef} onScroll={trackPosition} className="min-h-0 flex-1 overflow-auto">
          {files && renderGroup(files.staged, t("stagedChanges"))}
          {files && renderGroup(files.unstaged, t("changes"))}
        </div>
      )}
      {sendMenu && (
        <ContextMenu
          x={sendMenu.x}
          y={sendMenu.y}
          items={agentTargetMenuItems(t("diffNoAgentSession"))}
          onClose={() => setSendMenu(null)}
        />
      )}
    </div>
  );
}
