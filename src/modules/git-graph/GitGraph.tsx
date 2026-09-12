import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Clock, GitBranch, User } from "lucide-react";
import { Tooltip } from "@/components/Tooltip";
import type {
  CommitNode,
  CommitRef,
  GraphSelection,
  UncommittedSummary,
} from "./types";
import { RefChipStrip } from "./RefChipStrip";
import { DEFAULT_REF_CHIP_OPTIONS, type RefChipOptions } from "./lib/refChips";
import {
  computeGraphLayout,
  DEFAULT_GEOMETRY,
  edgePath,
  firstParentRowIndex,
  GUTTER_TRAIL,
  laneContinuationRowIndex,
  laneX,
} from "./lib/graphLayout";
import { isCurrentCommit } from "./lib/currentCommit";
import { BRANCH_COLORS } from "./lib/branchColors";
import { usePendingGraphSelectionStore } from "./lib/pendingGraphSelectionStore";

export interface GitGraphLabels {
  emptyTitle: string;
  emptyHint: string;
  loadMore: string;
  refHint: string;
  moreRefs: string;
  /** Message on the working-tree row while something is uncommitted. */
  uncommittedTitle: string;
  /** Message on the working-tree row while the tree is clean. */
  uncommittedClean: string;
  /** "3 staged · 4 unstaged", appended after the title. */
  uncommittedSummary: (staged: number, unstaged: number) => string;
}

interface GitGraphProps {
  commits: CommitNode[];
  selection: GraphSelection | null;
  onSelectCommit: (commit: CommitNode, options: { shiftKey: boolean }) => void;
  onCommitContextMenu?: (commit: CommitNode, x: number, y: number) => void;
  onRefContextMenu?: (
    ref: CommitRef,
    /** Remote refs folded into the clicked chip; empty for an unmerged one. */
    remotes: CommitRef[],
    x: number,
    y: number,
  ) => void;
  /** How ref chips are condensed; defaults to the shipped defaults. */
  refChipOptions?: RefChipOptions;
  hasMore?: boolean;
  onLoadMore?: () => void;
  /**
   * Counts for the working-tree row above the newest commit. `null` leaves the
   * row out altogether — that is the setting being off, not a clean tree; a
   * clean tree is `{ staged: 0, unstaged: 0 }` and still draws a (quiet) row.
   */
  uncommitted?: UncommittedSummary | null;
  onSelectWorkspace?: () => void;
  onWorkspaceContextMenu?: (x: number, y: number) => void;
  labels: GitGraphLabels;
}

/** Node and ring sizes at the full lane width; below it they shrink with it. */
const NODE_DOT = 12;
const NODE_MARGIN = 2;
const NODE_RING = 4;
/** Lanes' worth of distance a track takes to fade out past the last column. */
const LANE_FADE_LANES = 1;
const ROW_HEIGHT = DEFAULT_GEOMETRY.rowHeight;
const PADDING_TOP = DEFAULT_GEOMETRY.paddingTop;

/**
 * Path from the working-tree node down to HEAD: straight along its own track,
 * then one bend into HEAD's lane in the final row. Same shape as a branch tail
 * rejoining a trunk in `edgePath`, kept separate because this one is not an
 * edge — it has no parent/child to look up and must not take a lane colour.
 */
function uncommittedPath(x: number, y: number, headX: number, headY: number): string {
  if (headX === x) {
    return `M ${x} ${y} L ${x} ${headY}`;
  }
  const bend = Math.min(ROW_HEIGHT, headY - y);
  const turn = headY - bend;
  return `M ${x} ${y} L ${x} ${turn} C ${x} ${turn + bend * 0.5}, ${headX} ${headY - bend * 0.5}, ${headX} ${headY}`;
}

export function GitGraph({
  commits,
  selection,
  onSelectCommit,
  onCommitContextMenu,
  onRefContextMenu,
  refChipOptions = DEFAULT_REF_CHIP_OPTIONS,
  hasMore = false,
  onLoadMore,
  uncommitted = null,
  onSelectWorkspace,
  onWorkspaceContextMenu,
  labels,
}: GitGraphProps) {
  // All hooks run unconditionally before any early return so the hook order
  // stays stable when `commits` flips between empty and non-empty.
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ scrollTop: 0, height: 360 });

  // Measure the real scroll-container height so virtualization covers the full
  // visible area (a hardcoded height leaves the bottom blank until first scroll).
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) {
      return;
    }
    const sync = () =>
      setViewport((prev) => ({ ...prev, height: element.clientHeight }));
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const showUncommitted = uncommitted !== null;
  // The working-tree row is made room for by starting the commits one row
  // lower, rather than by shifting each drawn coordinate. Every y the graph
  // uses — nodes, rows, edge endpoints, the keyboard's scroll-into-view — comes
  // out of computeGraphLayout, so moving its origin moves all of them at once
  // and the row itself stays outside the lane and colour bookkeeping.
  const rowOffset = showUncommitted ? ROW_HEIGHT : 0;
  const geometry = useMemo(
    () => ({ ...DEFAULT_GEOMETRY, paddingTop: PADDING_TOP + rowOffset }),
    [rowOffset],
  );
  // HEAD takes the leftmost lane, so the working tree's dashed segment runs
  // straight down that lane into it and the branches that only happen to be
  // newer bend out to the right instead.
  //
  // Only while the row is drawn. The reordering exists to serve that segment,
  // and switching the row off has to put the graph back exactly as it was —
  // otherwise turning a feature off still leaves every lane moved.
  const headHash = useMemo(() => commits.find(isCurrentCommit)?.hash, [commits]);
  const layoutHead = showUncommitted ? headHash : undefined;
  const { layouts, edges, gutter, columns, laneWidth } = useMemo(
    () => computeGraphLayout(commits, geometry, layoutHead),
    [commits, geometry, layoutHead],
  );

  // The rows clear the tracks by the same number the tracks were sized with,
  // so a wider gutter takes the text with it instead of being drawn over. The
  // 12px back off is the leading inset `laneX` adds, which sits to the left of
  // lane 0's centre and is not track. At six lanes this is the 112px the rows
  // used to hardcode — the second copy of the gutter width, and the one that
  // put nodes on top of the hashes the moment the first copy could grow.
  const rowIndent = gutter - 12;

  // Lanes the gutter had no room for keep their real position and run past it,
  // over the rows. Rather than dimming those lines flat — which leaves faint
  // tracks lying across every message — they fade out with distance: solid
  // while they are inside the gutter, gone a little way beyond it. A line that
  // only just overruns stays legible; one far out is a hint that something is
  // there, not a mark to read. The stroke is a gradient in the svg's own
  // coordinates, so what fades is a position on the canvas rather than a
  // property of the line: a track that sweeps outward fades along its run, and
  // the part still inside the gutter is untouched.
  // From the last column the gutter really has, not from the gutter's outer
  // edge: that edge is a lane and a half further right, so starting there left
  // the first lane to overrun at full strength — the one case the fade exists
  // for. Three lanes later it is gone, so the overrun reads as a gradient
  // across the few tracks that do it rather than as a wall.
  const fadeFrom = laneX(columns - 1, geometry, { laneWidth, gutter, columns });
  const fadeTo = fadeFrom + laneWidth * LANE_FADE_LANES;
  // useId's own value carries colons, which have no business in a fragment
  // reference.
  const laneFade = `lane-fade-${useId().replace(/:/g, "")}`;
  const strokeFor = (colorIndex: number) =>
    `url(#${laneFade}-${colorIndex % BRANCH_COLORS.length})`;
  // A node is a div, not a stroke, so it reads the same ramp by hand.
  // The dot keeps its size at every lane width. What a lane has to clear is its
  // neighbour's track, which runs down that neighbour's centre, and a 12px dot
  // still stops 3px short of it at a 10px lane — being wider than the spacing
  // is not the same as being in the way.
  //
  // The selection mark is the one that does not fit: at the full width it
  // reaches 14px out, far enough to swallow the track beside it whole. The lift
  // goes first, since it costs more than anything else there and the row behind
  // the node is highlighted anyway.
  const roomy = laneWidth >= DEFAULT_GEOMETRY.laneWidth;
  // The ring keeps its weight at every lane width — a selection mark that is
  // 4px here and 1px there reads as two different marks. What gives way is the
  // gap between dot and ring, which costs the same pixels and shows nothing.
  // Once that is gone the ring does overlap the neighbouring track, by a pixel
  // at the narrowest lane: 4px of a 30% wash over a 2px line, against a
  // selection that is the same mark everywhere.
  const gap = roomy
    ? NODE_MARGIN
    : Math.max(0, Math.min(NODE_MARGIN, laneWidth - 1 - NODE_DOT / 2 - NODE_RING));
  const ring = NODE_RING;
  const nodeBox = NODE_DOT + gap * 2;
  const selectedRing = {
    transform: roomy ? "scale(1.25)" : undefined,
    boxShadow: `0 0 0 ${ring}px color-mix(in srgb, var(--color-accent) 30%, transparent)`,
  };

  const nodeOpacity = (x: number) =>
    x <= fadeFrom ? 1 : Math.max(0, 1 - (x - fadeFrom) / (fadeTo - fadeFrom));

  const isWorkspaceSelected = selection?.mode === "workspace";
  const activeHash =
    selection?.mode === "single"
      ? selection.commit.hash
      : selection?.mode === "compare"
        ? selection.to.hash
        : null;

  const isSelectedHash = (hash: string) =>
    selection?.mode === "compare"
      ? hash === selection.from.hash || hash === selection.to.hash
      : hash === activeHash;

  function selectFromClick(commit: CommitNode, event: { shiftKey: boolean }) {
    scrollRef.current?.focus();
    onSelectCommit(commit, { shiftKey: event.shiftKey });
  }

  // Without this, holding Shift while clicking asks the browser to extend a
  // native text selection from the last click point across every row in
  // between (the hash spans are selectable text) instead of firing a plain
  // click on this row — the compare pair never gets set, and it visibly
  // highlights text the user never meant to select.
  function preventShiftClickTextSelection(event: React.MouseEvent) {
    if (event.shiftKey) {
      event.preventDefault();
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (commits.length === 0) {
      return;
    }
    // The working-tree row is stepped on and off by position, not by the hash
    // walk below: it has no hash, so `commits.findIndex` would answer -1 for it
    // and every arrow key would fall through and do nothing.
    //
    // Plain arrows move by row, Shift follows the line. So a plain Down lands
    // on the row underneath — the newest commit — while Shift+Down follows the
    // dashed segment to HEAD, which is what the working tree actually sits on
    // and where that segment is drawn to. Those are the same row in the common
    // case and different ones as soon as another branch has newer commits;
    // taking the keyboard down to the newest commit while the line clearly ran
    // somewhere else was the graph and the keys telling different stories.
    if (isWorkspaceSelected) {
      if (event.key === "ArrowDown" && !event.shiftKey) {
        event.preventDefault();
        onSelectCommit(commits[0], { shiftKey: false });
        return;
      }
      if (event.key === "ArrowDown" && event.shiftKey) {
        const head = commits.find(isCurrentCommit);
        if (head) {
          event.preventDefault();
          onSelectCommit(head, { shiftKey: false });
        }
      }
      // Nothing sits above this row, and Shift+Up has no line to follow.
      return;
    }
    if (!activeHash) {
      return;
    }
    const currentIndex = commits.findIndex((c) => c.hash === activeHash);
    if (currentIndex === -1) {
      return;
    }
    // Any arrow key exits compare mode, even one that can't actually move
    // the selection (a boundary clamp or a dead-end lane) — it still
    // collapses onto the current commit as a single selection.
    const isComparing = selection?.mode === "compare";
    if (event.key === "ArrowDown" && !event.shiftKey) {
      event.preventDefault();
      const targetIndex = Math.min(currentIndex + 1, commits.length - 1);
      if (targetIndex !== currentIndex || isComparing) {
        onSelectCommit(commits[targetIndex], { shiftKey: false });
      }
    } else if (event.key === "ArrowUp" && !event.shiftKey) {
      event.preventDefault();
      // Off the top of the commits and onto the working-tree row, when it is
      // drawn. Without this the selection would just stick at index 0.
      if (currentIndex === 0 && showUncommitted && onSelectWorkspace) {
        onSelectWorkspace();
        return;
      }
      const targetIndex = Math.max(currentIndex - 1, 0);
      if (targetIndex !== currentIndex || isComparing) {
        onSelectCommit(commits[targetIndex], { shiftKey: false });
      }
    } else if (event.key === "ArrowDown" && event.shiftKey) {
      event.preventDefault();
      const parentHash = commits[currentIndex].parents[0];
      if (!parentHash) {
        if (isComparing) {
          onSelectCommit(commits[currentIndex], { shiftKey: false });
        }
        return;
      }
      const targetIndex = firstParentRowIndex(commits, currentIndex);
      if (targetIndex !== null) {
        onSelectCommit(commits[targetIndex], { shiftKey: false });
      } else {
        usePendingGraphSelectionStore.getState().request(parentHash);
      }
    } else if (event.key === "ArrowUp" && event.shiftKey) {
      event.preventDefault();
      const targetIndex = laneContinuationRowIndex(edges, currentIndex);
      if (targetIndex !== null) {
        onSelectCommit(commits[targetIndex], { shiftKey: false });
      } else if (
        showUncommitted &&
        onSelectWorkspace &&
        commits[currentIndex].hash === headHash
      ) {
        // Only the dashed segment continues HEAD's lane upward — no commit
        // does, since that lane is reserved — and following the line is what
        // this key means. Checked after a real continuation, never instead.
        onSelectWorkspace();
      } else if (isComparing) {
        onSelectCommit(commits[currentIndex], { shiftKey: false });
      }
    }
  }

  // Keep the active commit in view when keyboard navigation moves it off
  // the visible edge of the (virtualized, manually-scrolled) container.
  // Gated on activeHash actually changing (not just `layouts`, which gets a
  // new reference every time more history pages in) so browsing further
  // down the list doesn't keep snapping back to the still-selected row.
  const prevActiveHashRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeHash || !scrollRef.current) {
      prevActiveHashRef.current = activeHash;
      return;
    }
    if (activeHash === prevActiveHashRef.current) {
      return;
    }

    const layout = layouts[activeHash];
    if (!layout) {
      // Layout for this hash isn't ready yet (e.g. its page is still
      // loading) — leave prevActiveHashRef alone so a later render, once
      // the layout does exist, still recognizes this as an unhandled
      // hash change instead of skipping it.
      return;
    }
    prevActiveHashRef.current = activeHash;

    const container = scrollRef.current;
    const rowTop = layout.y - ROW_HEIGHT / 2;
    const rowBottom = layout.y + ROW_HEIGHT / 2;
    const { scrollTop, clientHeight } = container;

    if (rowTop < scrollTop) {
      container.scrollTop = rowTop;
    } else if (rowBottom > scrollTop + clientHeight) {
      container.scrollTop = rowBottom - clientHeight;
    }
  }, [activeHash, layouts]);

  // Stepping onto the working-tree row brings it into view. It lives above the
  // first commit, so that is simply the top; the hash-keyed effect above can't
  // do this one because the row has no hash to key on.
  useEffect(() => {
    if (isWorkspaceSelected && scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [isWorkspaceSelected]);

  const svgHeight = commits.length * ROW_HEIGHT + rowOffset + PADDING_TOP * 2 - 20;
  // Commit `i` is drawn at PADDING_TOP + rowOffset + i * ROW_HEIGHT, so the
  // offset comes back out before scroll position is turned into an index.
  const visibleStart = Math.max(
    0,
    Math.floor((viewport.scrollTop - PADDING_TOP - rowOffset) / ROW_HEIGHT) - 12,
  );
  const visibleEnd = Math.min(
    commits.length,
    Math.ceil((viewport.scrollTop + viewport.height + PADDING_TOP - rowOffset) / ROW_HEIGHT) + 12,
  );
  const visibleCommits = commits.slice(visibleStart, visibleEnd);

  // The dashed segment runs down to HEAD, which is what uncommitted changes are
  // relative to — not necessarily the first row, since the graph can show newer
  // commits from other branches above it. The node sits in HEAD's own lane, so
  // the segment is a straight vertical line down that lane and passes behind
  // any node on the way exactly as every other lane line already does (nodes
  // are z-10, the tracks z-[1]).
  const headLayout = headHash ? layouts[headHash] : undefined;
  // Directly above HEAD, which now owns the leftmost lane; lane 0 is the
  // fallback for a page that does not contain HEAD at all.
  const uncommittedX = headLayout?.x ?? laneX(0, geometry);
  const uncommittedY = PADDING_TOP;
  const isDirty = uncommitted !== null && uncommitted.staged + uncommitted.unstaged > 0;

  if (commits.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border p-8 py-16 text-center">
        <GitBranch className="mb-3 h-10 w-10 animate-pulse text-fg-subtle" />
        <p className="font-medium text-fg">{labels.emptyTitle}</p>
        <p className="mt-1 max-w-sm text-[13px] text-fg-subtle">{labels.emptyHint}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-bg">
      <div
        ref={scrollRef}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className="flex-1 overflow-auto outline-none"
        onScroll={(event) => {
          const target = event.currentTarget;
          setViewport({ scrollTop: target.scrollTop, height: target.clientHeight });
        }}
      >
        <div
          className="relative flex"
          style={{ minWidth: "900px", minHeight: `${svgHeight}px` }}
        >
          {/* SVG tracks column */}
          <div
            className="relative"
            style={{
              // From the same pass that placed the lanes, so the column can
              // never disagree with what was drawn into it.
              width: `${gutter}px`,
              minHeight: `${svgHeight}px`,
            }}
          >
            {/* z-[1] keeps the branch lines above a hovered/selected row's
                translucent background (which spans the gutter) but below the
                commit nodes (z-10), so the lines stay visible instead of being
                covered by the row tint. */}
            <svg
              className="pointer-events-none absolute inset-0 z-[1] h-full w-full"
              style={{ overflow: "visible" }}
            >
              <defs>
                {BRANCH_COLORS.map((color, idx) => (
                  <linearGradient
                    key={color}
                    id={`${laneFade}-${idx}`}
                    gradientUnits="userSpaceOnUse"
                    x1={fadeFrom}
                    x2={fadeTo}
                  >
                    <stop offset="0" stopColor={color} stopOpacity={0.8} />
                    <stop offset="1" stopColor={color} stopOpacity={0} />
                  </linearGradient>
                ))}
              </defs>
              {edges.map((edge, idx) => {
                // Draw every edge overlapping the visible row range so lines
                // stay continuous even when both endpoints are off-screen.
                if (edge.parentIndex < visibleStart || edge.childIndex > visibleEnd) {
                  return null;
                }
                return (
                  <path
                    key={`edge-${idx}`}
                    d={edgePath(edge, ROW_HEIGHT)}
                    fill="none"
                    stroke={strokeFor(edge.colorIndex)}
                    strokeWidth={2}
                  />
                );
              })}
              {/* Working tree → HEAD. Dashed and in the accent rather than a
                  lane colour, so it reads as "not history yet": straight down
                  its own track, then bending into HEAD in the last row. Drawn
                  after the lane lines so the bend, which crosses into HEAD's
                  lane, stays visible over the solid line already there. */}
              {showUncommitted && headLayout && (
                <path
                  d={uncommittedPath(uncommittedX, uncommittedY, headLayout.x, headLayout.y)}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeDasharray="3 4"
                  className={isDirty ? "text-accent opacity-70" : "text-fg-subtle opacity-40"}
                />
              )}
            </svg>

            {/* Working-tree node: hollow with a dashed ring, so it cannot be
                mistaken for either of the filled kinds — HEAD (accent + glow)
                or a commit (its lane's colour). */}
            {showUncommitted && (
              <Tooltip label={labels.uncommittedTitle}>
                <button
                  type="button"
                  aria-label={labels.uncommittedTitle}
                  onClick={() => {
                    scrollRef.current?.focus();
                    onSelectWorkspace?.();
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    onWorkspaceContextMenu?.(e.clientX, e.clientY);
                  }}
                  style={{
                    left: `${uncommittedX - nodeBox / 2}px`,
                    top: `${uncommittedY - nodeBox / 2}px`,
                    width: `${nodeBox}px`,
                    height: `${nodeBox}px`,
                    ...(isWorkspaceSelected ? selectedRing : null),
                  }}
                  className={`absolute z-10 flex items-center justify-center rounded-full transition-all focus:outline-none ${
                    isWorkspaceSelected ? "" : "hover:scale-110"
                  }`}
                >
                  <span
                    className={`h-3 w-3 rounded-full border-2 border-dashed bg-bg ${
                      isDirty ? "border-accent" : "border-fg-subtle opacity-60"
                    }`}
                  />
                </button>
              </Tooltip>
            )}

            {/* Commit nodes positioned over the SVG */}
            {visibleCommits.map((commit) => {
              const layout = layouts[commit.hash];
              if (!layout) {
                return null;
              }
              const color = BRANCH_COLORS[layout.colorIndex % BRANCH_COLORS.length];
              const isSelected = isSelectedHash(commit.hash);
              const isCurrent = isCurrentCommit(commit);
              return (
                <Tooltip key={commit.hash} label={commit.hash}>
                  <button
                    type="button"
                    onMouseDown={preventShiftClickTextSelection}
                    onClick={(e) => selectFromClick(commit, e)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      onCommitContextMenu?.(commit, e.clientX, e.clientY);
                    }}
                    style={{
                      left: `${layout.x - nodeBox / 2}px`,
                      top: `${layout.y - nodeBox / 2}px`,
                      width: `${nodeBox}px`,
                      height: `${nodeBox}px`,
                      opacity: nodeOpacity(layout.x),
                      ...(isSelected ? selectedRing : null),
                    }}
                    className={`absolute flex items-center justify-center rounded-full transition-all focus:outline-none ${
                      layout.x > fadeFrom ? "z-0" : "z-10"
                    } ${isSelected ? "" : "hover:scale-110"}`}
                  >
                    {/* The current (HEAD) node is filled with the accent — a colour
                        the branch lanes never use — and glows, so it reads as "you
                        are here" without touching the calm commit rows. */}
                    <span
                      style={isCurrent ? undefined : { backgroundColor: color }}
                      className={`h-3 w-3 rounded-full border-2 border-bg ${
                        isCurrent ? "git-head-node bg-accent" : "shadow-md"
                      }`}
                    />
                  </button>
                </Tooltip>
              );
            })}
          </div>

          {/* Commit rows aligned with their node y */}
          <div className="flex-1 pr-4">
            {showUncommitted && (
              <div
                onClick={() => {
                  scrollRef.current?.focus();
                  onSelectWorkspace?.();
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  onWorkspaceContextMenu?.(e.clientX, e.clientY);
                }}
                style={{
                  height: `${ROW_HEIGHT}px`,
                  top: `${uncommittedY - ROW_HEIGHT / 2}px`,
                  paddingLeft: `${rowIndent}px`,
                }}
                className={`absolute left-0 right-4 flex cursor-pointer items-center justify-between rounded border py-1 pr-3 transition-all ${
                  isWorkspaceSelected
                    ? "border-border-strong bg-bg-elevated/60 text-fg shadow-sm"
                    : "border-transparent text-fg-muted hover:bg-bg-elevated/40 hover:text-fg"
                }`}
              >
                <div className="flex items-center space-x-3 overflow-hidden pr-2">
                  {/* Placeholder in the hash column, dimmed and the same width,
                      so the columns still line up down the whole list. */}
                  <span className="font-mono text-xs font-semibold text-fg-subtle opacity-50">
                    •••••••
                  </span>
                  <span
                    className={`truncate font-sans text-[13px] font-medium ${
                      isDirty ? "text-fg" : "text-fg-subtle"
                    }`}
                  >
                    {isDirty ? labels.uncommittedTitle : labels.uncommittedClean}
                  </span>
                  {/* Counts sit right after the message, not out in the
                      author/time column: that column belongs to things the
                      working tree does not have, and numbers parked at the far
                      end of a wide row read as unrelated to their label. */}
                  {isDirty && uncommitted && (
                    <span className="shrink-0 font-mono text-[11px] text-fg-muted">
                      {labels.uncommittedSummary(uncommitted.staged, uncommitted.unstaged)}
                    </span>
                  )}
                </div>
                {/* The author/time column stays empty — the cheapest signal
                    there is that this row is not a commit. */}
              </div>
            )}
            {visibleCommits.map((commit) => {
              const layout = layouts[commit.hash];
              if (!layout) {
                return null;
              }
              const isSelected = isSelectedHash(commit.hash);
              const isCurrent = isCurrentCommit(commit);
              // The HEAD commit is marked at its graph node (filled accent + glow);
              // its row stays calm and only brightens to full foreground, so the
              // list reads uniformly. Selection keeps its own filled style.
              // The row (hit area, border and background) spans the full
              // width including the lane gutter; backgrounds stay translucent
              // so the SVG branch lines remain visible underneath.
              const rowState = isSelected
                ? "border-border-strong bg-bg-elevated/60 text-fg shadow-sm"
                : isCurrent
                  ? "border-transparent text-fg hover:bg-bg-elevated/40"
                  : "border-transparent text-fg-muted hover:bg-bg-elevated/40 hover:text-fg";
              return (
                <div
                  key={commit.hash}
                  onMouseDown={preventShiftClickTextSelection}
                  onClick={(e) => selectFromClick(commit, e)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    onCommitContextMenu?.(commit, e.clientX, e.clientY);
                  }}
                  style={{
                    height: `${ROW_HEIGHT}px`,
                    top: `${layout.y - ROW_HEIGHT / 2}px`,
                    paddingLeft: `${rowIndent}px`,
                  }}
                  className={`absolute left-0 right-4 flex cursor-pointer items-center justify-between rounded border py-1 pr-3 transition-all ${rowState}`}
                >
                  <div className="flex items-center space-x-3 overflow-hidden pr-2">
                    <span className="select-all font-mono text-xs font-semibold text-accent">
                      {commit.hash}
                    </span>

                    <RefChipStrip
                      refs={commit.refs}
                      options={refChipOptions}
                      labels={labels}
                      onRefContextMenu={onRefContextMenu}
                    />

                    <span className="truncate font-sans text-[13px] font-medium text-fg">
                      {commit.message}
                    </span>
                  </div>

                  <div className="flex shrink-0 items-center space-x-4 font-mono text-[13px] text-fg-subtle">
                    <div className="flex items-center space-x-1">
                      <User className="h-3 w-3" />
                      <span className="max-w-[70px] truncate">{commit.author}</span>
                    </div>
                    <div className="flex items-center space-x-1">
                      <Clock className="h-3 w-3" />
                      <span>{commit.date}</span>
                    </div>
                  </div>
                </div>
              );
            })}
            {hasMore && (
              <div
                className="absolute right-4 flex items-center justify-center"
                // Its own inset rather than the rows': this centres a button in
                // whatever is left, so it only has to clear the tracks. Keeps
                // the 100px it had at six lanes.
                style={{
                  left: `${gutter - GUTTER_TRAIL}px`,
                  top: `${svgHeight - 34}px`,
                  height: "32px",
                }}
              >
                <button
                  type="button"
                  onClick={onLoadMore}
                  className="rounded border border-border-strong bg-bg-elevated px-3 py-1.5 font-mono text-[12px] font-bold text-fg hover:bg-bg-inset"
                >
                  {labels.loadMore}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
