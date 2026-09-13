import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  ChevronUp,
  Loader2,
  Send,
  SquareSplitHorizontal,
  SquareSplitVertical,
  WrapText,
} from "lucide-react";
import { PaneHeader } from "@/components/PaneHeader";
import { Tooltip } from "@/components/Tooltip";
import { ContextMenu } from "@/components/ContextMenu";
import {
  gitDiff,
  gitDiffFromBase,
  gitResolveRepo,
  gitResolveRev,
  gitStatus,
} from "@/modules/source-control/lib/gitBridge";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { buildFileTree, flattenFileTree } from "@/lib/fileTree";
import { useSettingsStore } from "@/stores/settingsStore";
import { changedLines, parseDiffStats, type FileDiffStats } from "./lib/parseDiffStats";
import { ComparisonBaseSelector } from "./ComparisonBaseSelector";
import { baseFor, useComparisonBaseStore } from "./lib/comparisonBaseStore";
import { agentTargetMenuItems } from "./lib/sendComments";
import { changeAtViewportTop } from "./lib/changeAtTop";
import { useAllChangesLinkStore } from "./lib/allChangesLinkStore";
import { useUnsentCommentCount } from "./lib/useDiffComments";
import {
  DiffFileSection,
  TRUNCATE_CHANGED_LINES,
  type ChangedFile,
  type DiffSectionHandle,
} from "./DiffFileSection";

interface AllChangesTabContentProps {
  /**
   * The pane this page is in. Everything it publishes to the panel is filed
   * under it: a split mounts two of these pages, and one global entry each
   * would have them overwriting one another's mark and clearing it on the way
   * out.
   */
  paneId: string;
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

/** How long a scan may take before the page admits it is out of date. Below
 * this an indicator would flash rather than inform. */
const SLOW_SCAN_MS = 200;

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

/**
 * A file staged and then edited again appears in both sections, as two
 * independent comparisons, so the side is part of its identity.
 */
export function sectionKey(rel: string, staged: boolean): string {
  return `${staged ? "s" : "w"}:${rel}`;
}

function toChangedFile(
  repo: string,
  file: { path: string; status: string },
  staged: boolean,
  stats: Map<string, FileDiffStats>,
): ChangedFile {
  return {
    key: sectionKey(file.path, staged),
    rel: file.path,
    path: `${repo}/${file.path}`,
    staged,
    status: file.status,
    stats: stats.get(file.path) ?? null,
    from: stats.get(file.path)?.from,
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
export function AllChangesTabContent({
  paneId,
  showClose = false,
  onClose,
}: AllChangesTabContentProps) {
  const { t } = useTranslation("sourceControl");
  const { t: tEditor } = useTranslation("editor");
  const rootPath = useWorkspaceStore((s) => s.rootPath);
  const wordWrap = useSettingsStore((s) => s.wordWrap);
  const toggleWordWrap = useSettingsStore((s) => s.toggleWordWrap);
  const unified = useSettingsStore((s) => s.diffUnified);
  const toggleUnified = useSettingsStore((s) => s.toggleDiffUnified);
  const unsent = useUnsentCommentCount();
  const byRepo = useComparisonBaseStore((s) => s.byRepo);
  const includeUncommitted = useComparisonBaseStore((s) => s.includeUncommitted);
  const setIncludeUncommitted = useComparisonBaseStore((s) => s.setIncludeUncommitted);
  const clearBase = useComparisonBaseStore((s) => s.clear);

  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(false);
  const [repo, setRepo] = useState<string | null>(null);
  const [resolved, setResolved] = useState(false);
  const [files, setFiles] = useState<ChangedFiles | null>(null);
  const [error, setError] = useState(false);
  /**
   * The rev behind the base, when git no longer has it.
   *
   * Its own state rather than one more way to say "load failed", because it
   * is the one failure here with a cause worth naming and a way out. A base
   * chosen at the start of a session can be gone by the middle of it -- the
   * branch merged and deleted, or the remote-tracking ref pruned by a fetch,
   * or the commits in a range rebased away -- and the page would sit there
   * saying only that something went wrong, about a name it was still
   * displaying in the header.
   */
  const [gone, setGone] = useState<{ rev: string; why: "missing" | "unrelated" } | null>(
    null,
  );
  const [refreshKey, setRefreshKey] = useState(0);
  // The rev every section reads its "before" document at. Null while the
  // base is the working tree, where the two sides are HEAD/index/disk and
  // each section already knows which.
  const [baseRev, setBaseRev] = useState<string | null>(null);
  // The far end, when there is one. Each file's "after" document is read here
  // instead of from disk -- a range does not involve the working tree.
  const [baseTo, setBaseTo] = useState<string | null>(null);
  /**
   * A scan is in flight and has been long enough to be worth saying so.
   *
   * Not simply "a scan is running": on a local repo that is a few tens of
   * milliseconds, and an indicator that appears and vanishes inside a tenth of
   * a second reads as a glitch rather than as work. The panel next door has
   * the same problem from the other end -- MIN_REFRESH_MS holds its spinner up
   * so it can be seen at all.
   *
   * What it is really for is the case speed hides: until the new scan lands,
   * the page is still showing the previous base's files under the new base's
   * name. At 80ms nobody sees it; on a wide divergence or a cold cache it sits
   * there looking correct and being wrong.
   */
  const [stale, setStale] = useState(false);
  // The panel's refresh button asks for a rescan too: while this page has the
  // pane, that button is the only refresh control on screen, and the panel's
  // list and this one have to move together.
  const rescan = useAllChangesLinkStore((s) => s.rescan[paneId] ?? 0);
  // Either trigger moves this, and both only ever count up.
  const reloadKey = refreshKey + rescan;
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
  // Where the header of the file being shut sat, so the page can put it back
  // there once the body it was holding is gone (see onToggleCollapse).
  const anchorRef = useRef<{ key: string; top: number } | null>(null);
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
  // The listing belongs to a page that is up; a panel left holding one after
  // the page closed would offer rows that scroll nothing.
  useEffect(() => () => useAllChangesLinkStore.getState().setListing(paneId, null), []);

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
    async function scanFromBase(
      repoPath: string,
      from: string,
      to: string | undefined,
    ) {
      // One comparison, not two halves: `git diff <merge-base>` already covers
      // what was committed on this branch and what is still on disk. The file
      // list comes out of that same diff rather than from status, so the list
      // and the counts cannot disagree -- and so the page is one git call
      // instead of three.
      try {
        // Two named points are compared literally (two-dot): neither of them is
        // the line the other left, so a merge base would answer a question
        // nobody asked. A ref goes three-dot, and only then does the
        // uncommitted switch mean anything.
        // `git diff` only reports tracked files, so a file created and not
        // added is invisible to it -- while the checkbox next door says
        // uncommitted work is included. `git status` is the only thing that
        // knows about one, so it is asked too, and only where the answer can
        // differ: a range has no working tree in it at either end, and with
        // the switch off the comparison stops at the last commit.
        const alsoOnDisk = to === undefined && includeUncommitted;
        const [{ rev, diff }, status] = await Promise.all([
          gitDiffFromBase(repoPath, from, to === undefined, includeUncommitted, to),
          alsoOnDisk ? gitStatus(repoPath) : Promise.resolve(null),
        ]);
        if (cancelled) {
          return;
        }
        const stats = parseDiffStats(diff);
        setError(false);
        setGone(null);
        setBaseRev(rev);
        setBaseTo(to ?? null);
        const listed = [...stats.keys()].map((path) => ({
          path,
          // What the diff itself says happened to the file. There is no status
          // to ask here -- a comparison of two points in history is not about
          // the working tree -- but the diff carries the same letters.
          status: stats.get(path)?.status ?? "M",
        }));
        for (const file of status?.unstaged ?? []) {
          if (file.status === "?" && !stats.has(file.path)) {
            listed.push({ path: file.path, status: "?" });
          }
        }
        const ordered = flattenFileTree(buildFileTree(listed));
        setFiles({
          staged: [],
          unstaged: ordered.map((file) => toChangedFile(repoPath, file, false, stats)),
        });
        // Hand the panel the same list, in the same order, so the two are one
        // index of one comparison rather than two lists that happen to be
        // side by side.
        useAllChangesLinkStore.getState().setListing(paneId, {
          label: to ? `${from}..${to}` : from,
          range: to !== undefined,
          files: ordered.map((file) => ({ rel: file.path, status: file.status })),
        });
      } catch (failure) {
        if (cancelled) {
          return;
        }
        // Two branches that never shared a commit have no point to measure
        // from, which the command says outright. Both refs resolve, so the
        // question below would find nothing wrong and the page would report
        // only that something failed -- about a base it was still naming in
        // the header.
        if (String(failure).includes("no common history")) {
          setGone({ rev: from, why: "unrelated" });
          return;
        }
        // Ask which failure this was before reporting one. A rev git cannot
        // resolve is the likely cause and the only one with an answer, so it
        // is worth one extra call on a path that has already failed.
        for (const rev of to === undefined ? [from] : [from, to]) {
          const known = await gitResolveRev(repoPath, rev)
            .then((sha) => sha !== null)
            // A failed question is not a missing ref; fall through to the
            // generic message rather than blaming the base.
            .catch(() => true);
          if (cancelled) {
            return;
          }
          if (!known) {
            setGone({ rev, why: "missing" });
            return;
          }
        }
        setError(true);
      }
    }
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
        setGone(null);
        // Stacked the way the Source Control panel draws its tree — folders
        // before files at each level, each alphabetical — rather than in the
        // order status happens to report. A page of dozens of files reads
        // better with a directory's changes together, and it means the panel
        // beside it lists the same files in the same order rather than being a
        // differently sorted index of them.
        setFiles({
          staged: flattenFileTree(buildFileTree(status.staged)).map((file) =>
            toChangedFile(repoPath, file, true, stagedStats),
          ),
          unstaged: flattenFileTree(buildFileTree(status.unstaged)).map((file) =>
            toChangedFile(repoPath, file, false, workingStats),
          ),
        });
      } catch {
        if (!cancelled) {
          setError(true);
        }
      }
    }
    const base = baseFor(byRepo, repo);
    const slow = window.setTimeout(() => {
      if (!cancelled) {
        setStale(true);
      }
    }, SLOW_SCAN_MS);
    const done = () => {
      window.clearTimeout(slow);
      if (!cancelled) {
        setStale(false);
      }
    };
    if (base.kind === "ref") {
      void scanFromBase(repo, base.name, undefined).finally(done);
    } else if (base.kind === "range") {
      void scanFromBase(repo, base.from, base.to).finally(done);
    } else {
      setBaseRev(null);
      setBaseTo(null);
      // Back to the working tree: the panel's own list is right again.
      useAllChangesLinkStore.getState().setListing(paneId, null);
      void scan(repo).finally(done);
    }
    return () => {
      cancelled = true;
      window.clearTimeout(slow);
    };
    // Re-scans when the base changes, which is the whole point of the
    // selector; `byRepo` is the store's map, so any repo's base moving
    // re-runs this, and the one that matters is read out of it above.
  }, [repo, reloadKey, byRepo, includeUncommitted]);

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

  /**
   * Shutting a file takes its whole body out of the flow, and everything below
   * slides up by that much. The page's scroll position does not move with it,
   * so a reader half way down a long file lands several files further on with
   * no idea where they are.
   *
   * So the header is pinned: whatever offset it sat at is the offset it keeps.
   * Clamping at zero is what makes the interesting case work -- scrolled well
   * into the file, the section's top is far above the viewport but its header
   * is not, because the header is sticky and has been sitting at the top of
   * the pane all along. Zero is where it already is, so it does not move at
   * all; the landing gap other jumps leave would drop it those few pixels. A
   * header still on screen has an offset inside the viewport and stays put.
   */
  const onToggleCollapse = useCallback((key: string) => {
    // A jump waiting on editors that were not up yet finishes itself the
    // moment a handle registers, and shutting a file registers handles. The
    // reader shutting something is a newer instruction than a jump they asked
    // for before it, so the jump is dropped rather than allowed to land on
    // top of the pinning below.
    setPending(null);
    const root = scrollRef.current;
    const element = elementsRef.current.get(key);
    if (root && element) {
      anchorRef.current = {
        key,
        top: element.getBoundingClientRect().top - root.getBoundingClientRect().top,
      };
    }
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) {
        next.add(key);
      }
      return next;
    });
  }, []);

  // Before the browser paints the shorter page, so the jump is never seen.
  useLayoutEffect(() => {
    const pinned = anchorRef.current;
    anchorRef.current = null;
    const root = scrollRef.current;
    const element = pinned ? elementsRef.current.get(pinned.key) : null;
    if (!pinned || !root || !element) {
      return;
    }
    const now = element.getBoundingClientRect().top - root.getBoundingClientRect().top;
    root.scrollTop = Math.max(0, root.scrollTop + now - Math.max(pinned.top, 0));
  }, [collapsed]);

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
  /** Where a file's section starts inside the page's scrollable content. */
  const sectionTop = useCallback(
    (root: HTMLElement, index: number): number | null => {
      const element = ordered[index] && elementsRef.current.get(ordered[index].key);
      if (!element) {
        return null;
      }
      // The section, never its header: the header is sticky, so its rect
      // reports where it is pinned rather than where it belongs.
      return (
        root.scrollTop + element.getBoundingClientRect().top - root.getBoundingClientRect().top
      );
    },
    [ordered],
  );

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
      // The panel marks the row the reader is on, which is the file at the top
      // of the page — the same question the counter asks, one level up, so it
      // takes the same lazy binary search over an ordered list. The topmost
      // *file* rather than the file owning the topmost change: a file with no
      // change to navigate to, folded or binary, is still one you can be
      // looking straight at.
      // Clamped, unlike the counter above: "before the first change" is a
      // real place for a navigation cursor to be, but a reader sitting at the
      // top of the page is looking at the first file, not at no file — and the
      // panel would mark nothing until they scrolled past the group heading.
      const at = changeAtViewportTop(ordered.length, top, (i) => sectionTop(root, i));
      const file = ordered[Math.max(0, at - 1)];
      useAllChangesLinkStore
        .getState()
        .setShowing(paneId, file ? { rel: file.rel, staged: file.staged } : null);
    });
  }, [changes.length, changeTop, ordered, sectionTop]);

  // Mark the first file as soon as there is a list, without waiting for a
  // scroll, and let the mark go when this page does — the panel falls back to
  // whichever diff pane is in front, as it did before.
  useEffect(() => {
    trackPosition();
  }, [trackPosition]);

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
      useAllChangesLinkStore.getState().forget(paneId);
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

  /**
   * Put a file's header at the top of the page. Used by the Source Control
   * panel: while this page is in front, clicking a row scrolls here instead of
   * opening a diff tab of its own.
   */
  const scrollToSection = useCallback((key: string) => {
    const root = scrollRef.current;
    const element = elementsRef.current.get(key);
    if (!root || !element) {
      return false;
    }
    setMounted((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
    // A file the reader had shut opens again: they just asked for it, and
    // landing on a bare header reads as nothing having happened. A file folded
    // for its size keeps its own control — that one is about weight, not about
    // having been read.
    setCollapsed((prev) => {
      if (!prev.has(key)) {
        return prev;
      }
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    root.scrollTop = Math.max(
      0,
      root.scrollTop + element.getBoundingClientRect().top - root.getBoundingClientRect().top,
    );
    return true;
  }, []);

  const requested = useAllChangesLinkStore((s) => s.file[paneId]);
  useEffect(() => {
    // Wait for the scan: there are no sections to scroll to before it lands.
    if (!requested || ordered.length === 0) {
      return;
    }
    scrollToSection(sectionKey(requested.rel, requested.staged));
    // Consumed either way. A row for a file this page does not carry (a stale
    // click, or one raced with a rescan) is dropped rather than left to fire
    // at some unrelated moment later.
    useAllChangesLinkStore.getState().consume(paneId);
  }, [requested, ordered, scrollToSection]);

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

  /**
   * The base as something an effect can be keyed on. `byRepo` is a new map on
   * every write, so it moves when any repo's base does; the value for this
   * repo, flattened, moves only when this page's comparison does.
   */
  const baseKey = useMemo(() => JSON.stringify(baseFor(byRepo, repo)), [byRepo, repo]);

  // Open on the first change rather than above it, so the counter starts at
  // 1/N and there is a change on screen to read — the same landing the
  // single-file tab makes, and cheap here because the collapsed run at the top
  // of the first file leaves it only a little way down. Once per scan: a
  // reload must not haul the reader back to the top of the page.
  const landed = useRef(false);

  /**
   * A different base is a different page: other files, in another order, of a
   * comparison the reader has not read a line of. The offset they were at
   * measured the page that is gone, so it goes back to the top.
   *
   * To the very top, and the landing below is left switched off rather than
   * armed again. Opening on the first change is right for a page that appears
   * — it is why the tab was opened — but a page that has just been pointed at
   * something else is first asked what it now holds, and the answer is the
   * heading with the file count on it, which the landing scrolls away.
   *
   * The base only. A rescan of the same comparison — the window regaining
   * focus, the panel's refresh button — is the page they are already reading,
   * and dragging them to the top of it every time they alt-tab back would be a
   * bug of its own.
   */
  const shownBase = useRef(baseKey);
  useEffect(() => {
    if (shownBase.current === baseKey) {
      return;
    }
    shownBase.current = baseKey;
    landed.current = true;
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [baseKey]);
  useEffect(() => {
    if (landed.current || changes.length === 0) {
      return;
    }
    landed.current = true;
    setPosition(1);
    jumpTo(changes[0]);
  }, [changes, jumpTo]);

  function goToChange(direction: "prev" | "next") {
    if (changes.length === 0) {
      return;
    }
    // The reader taking over. The landing is an effect, so it can still be
    // waiting to run when the page is finished enough to press this -- and
    // arriving afterwards it would put them back on the first change, one
    // press after they asked to leave it.
    landed.current = true;
    // Steps from the position as read, not from the raw one. The two differ
    // only at the top of the page, where the raw one is still zero — above the
    // first change, technically, though that change is on screen — and Next
    // would otherwise spend its first press moving the number from zero to one
    // while the page stayed where it was.
    const from = Math.max(1, position);
    const next =
      direction === "next" ? Math.min(from + 1, changes.length) : Math.max(from - 1, 1);
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
            baseRev={baseRev}
            // A range reads its far end; a ref with the switch off stops at
            // HEAD; otherwise the file on disk.
            baseTo={baseTo ?? (baseRev !== null && !includeUncommitted ? "HEAD" : null)}
            onToggleCollapse={() => onToggleCollapse(file.key)}
            reserved={heightsRef.current.get(file.key) ?? 0}
            onMeasure={onMeasure}
            onHandle={onHandle}
            onCounted={onCounted}
            onDraft={onDraft}
            narrow={narrow}
            reloadKey={reloadKey}
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
          // Not `overflow-hidden` any more, though the actions opposite still
          // never shrink: the base selector's list hangs out of this row, and a
          // clip here cut it down to the sliver that fits a 28px header. The
          // title truncates itself instead, which bounds this side just the
          // same -- the selector's own width is fixed.
          <div className="flex min-w-0 items-center gap-2">
            {!narrow && (
              <span className="min-w-0 truncate text-xs text-fg-muted">{t("allChanges")}</span>
            )}
            {/* What the page is comparing against. It stands where the
                "(uncommitted)" label used to: that label was naming the
                comparison all along, and this says the same thing when it is
                the working tree while being able to say something else. */}
            <ComparisonBaseSelector repo={repo} narrow={narrow} />
            {/* Only with a ref for a base. Against the working tree there is
                nothing to include or leave out -- everything on the page is
                uncommitted by definition -- and against a range neither end is
                on disk, so there is nothing for it to say either. A control
                that can never do anything is absent rather than greyed out for
                people to wonder about. */}
            {baseRev !== null && baseTo === null && !narrow && (
              <label className="flex shrink-0 select-none items-center gap-1.5 text-xs text-fg-muted">
                <input
                  type="checkbox"
                  checked={includeUncommitted}
                  onChange={(e) => setIncludeUncommitted(e.target.checked)}
                  className="h-3 w-3 accent-accent"
                />
                {t("baseIncludeUncommitted")}
              </label>
            )}
            {/* Last, after both controls rather than between them. The
                selector and this checkbox are one thought -- what is being
                compared -- and a spinner appearing between them shoves the
                checkbox sideways every time a scan runs long. At the end, only
                empty space moves. It says "still working"; the dimmed list
                below says which part is out of date. */}
            {stale && <Loader2 size={12} className="shrink-0 animate-spin text-fg-subtle" />}
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
                {/* From one, never zero: a page that opens at "0/215" reads
                    as having failed to count. The state behind it keeps the
                    zero, which is honestly what "not measured yet, or above
                    the first change" is. */}
                {Math.max(1, position)}/{changes.length}
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
      ) : gone ? (
        <div className="flex flex-col items-start gap-1.5 px-3 py-2 text-xs">
          <p className="text-danger">
            {t(gone.why === "unrelated" ? "baseUnrelated" : "baseGone", { name: gone.rev })}
          </p>
          {/* The selector in the header is the other way out, and it was
              there all along; this is the one for a reader who just wants
              the page back. */}
          <button
            type="button"
            onClick={() => repo && clearBase(repo)}
            className="rounded border border-border px-2 py-0.5 text-fg-muted hover:bg-bg-elevated hover:text-fg"
          >
            {t("baseBackToWorktree")}
          </button>
        </div>
      ) : error ? (
        <p className="px-3 py-2 text-xs text-danger">{t("diffLoadError")}</p>
      ) : empty ? (
        <p className="px-3 py-2 text-xs text-fg-subtle">{t("noChanges")}</p>
      ) : (
        <div
          ref={scrollRef}
          onScroll={trackPosition}
          // Dimmed, not covered: these are still the files the reader was
          // reading a moment ago, and they stay scrollable and readable. What
          // the dimming says is only that they belong to the base that was
          // named here before, not the one named now.
          className={`min-h-0 flex-1 overflow-auto transition-opacity ${
            stale ? "opacity-50" : ""
          }`}
        >
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
