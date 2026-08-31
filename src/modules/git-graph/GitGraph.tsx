import { useEffect, useMemo, useRef, useState } from "react";
import { Clock, GitBranch, User } from "lucide-react";
import { Tooltip } from "@/components/Tooltip";
import type { CommitNode, CommitRef, GraphSelection } from "./types";
import { RefChipStrip } from "./RefChipStrip";
import { DEFAULT_REF_CHIP_OPTIONS, type RefChipOptions } from "./lib/refChips";
import {
  computeGraphLayout,
  DEFAULT_GEOMETRY,
  edgePath,
  firstParentRowIndex,
  laneContinuationRowIndex,
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
  labels: GitGraphLabels;
}

const NODE_RADIUS = 6;
const ROW_HEIGHT = DEFAULT_GEOMETRY.rowHeight;
const PADDING_TOP = DEFAULT_GEOMETRY.paddingTop;

export function GitGraph({
  commits,
  selection,
  onSelectCommit,
  onCommitContextMenu,
  onRefContextMenu,
  refChipOptions = DEFAULT_REF_CHIP_OPTIONS,
  hasMore = false,
  onLoadMore,
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

  const { layouts, edges } = useMemo(() => computeGraphLayout(commits), [commits]);

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
    if (commits.length === 0 || !activeHash) {
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

  const svgHeight = commits.length * ROW_HEIGHT + PADDING_TOP * 2 - 20;
  const visibleStart = Math.max(
    0,
    Math.floor((viewport.scrollTop - PADDING_TOP) / ROW_HEIGHT) - 12,
  );
  const visibleEnd = Math.min(
    commits.length,
    Math.ceil((viewport.scrollTop + viewport.height + PADDING_TOP) / ROW_HEIGHT) + 12,
  );
  const visibleCommits = commits.slice(visibleStart, visibleEnd);

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
              width: `${DEFAULT_GEOMETRY.paddingLeft + 6 * DEFAULT_GEOMETRY.laneWidth + 24}px`,
              minHeight: `${svgHeight}px`,
            }}
          >
            {/* z-[1] keeps the branch lines above a hovered/selected row's
                translucent background (which spans the gutter) but below the
                commit nodes (z-10), so the lines stay visible instead of being
                covered by the row tint. */}
            <svg className="pointer-events-none absolute inset-0 z-[1] h-full w-full">
              {edges.map((edge, idx) => {
                // Draw every edge overlapping the visible row range so lines
                // stay continuous even when both endpoints are off-screen.
                if (edge.parentIndex < visibleStart || edge.childIndex > visibleEnd) {
                  return null;
                }
                const color = BRANCH_COLORS[edge.colorIndex % BRANCH_COLORS.length];
                return (
                  <path
                    key={`edge-${idx}`}
                    d={edgePath(edge, ROW_HEIGHT)}
                    fill="none"
                    stroke={color}
                    strokeWidth={2}
                    className="opacity-80"
                  />
                );
              })}
            </svg>

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
                      left: `${layout.x - NODE_RADIUS - 2}px`,
                      top: `${layout.y - NODE_RADIUS - 2}px`,
                      width: `${(NODE_RADIUS + 2) * 2}px`,
                      height: `${(NODE_RADIUS + 2) * 2}px`,
                    }}
                    className={`absolute z-10 flex items-center justify-center rounded-full transition-all focus:outline-none ${
                      isSelected ? "scale-125 ring-4 ring-accent/30" : "hover:scale-110"
                    }`}
                  >
                    {/* The current (HEAD) node is filled with the accent — a colour
                        the branch lanes never use — and glows, so it reads as "you
                        are here" without touching the calm commit rows. */}
                    <span
                      className={`h-3 w-3 rounded-full border-2 border-bg ${
                        isCurrent ? "git-head-node bg-accent" : "shadow-md"
                      }`}
                      style={isCurrent ? undefined : { backgroundColor: color }}
                    />
                  </button>
                </Tooltip>
              );
            })}
          </div>

          {/* Commit rows aligned with their node y */}
          <div className="flex-1 pr-4">
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
                  }}
                  className={`absolute left-0 right-4 flex cursor-pointer items-center justify-between rounded border py-1 pl-[112px] pr-3 transition-all ${rowState}`}
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
                className="absolute left-[100px] right-4 flex items-center justify-center"
                style={{ top: `${svgHeight - 34}px`, height: "32px" }}
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
