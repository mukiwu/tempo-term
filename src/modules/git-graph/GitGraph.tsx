import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Clock, GitBranch, Tag, User } from "lucide-react";
import type { CommitNode, CommitRef } from "./types";
import {
  computeGraphLayout,
  DEFAULT_GEOMETRY,
  edgePath,
} from "./lib/graphLayout";

export interface GitGraphLabels {
  emptyTitle: string;
  emptyHint: string;
  loadMore: string;
  refHint: string;
}

interface GitGraphProps {
  commits: CommitNode[];
  selectedCommit: CommitNode | null;
  onSelectCommit: (commit: CommitNode) => void;
  onCommitContextMenu?: (commit: CommitNode, x: number, y: number) => void;
  onRefContextMenu?: (ref: CommitRef, x: number, y: number) => void;
  hasMore?: boolean;
  onLoadMore?: () => void;
  labels: GitGraphLabels;
}

// Lane colours cycle through the semantic accent tokens so the graph reads well
// in either theme (the tokens are remapped per theme, unlike hardcoded hex).
const LANE_COLORS = [
  "var(--color-accent)",
  "var(--color-purple-500)",
  "var(--color-warning)",
  "var(--color-success)",
  "var(--color-danger)",
];

// Decoration chip styles per ref kind, built from semantic tokens.
const REF_CHIP_STYLES: Record<string, string> = {
  head: "border-success/40 bg-success/15 text-success",
  branch: "border-accent/40 bg-accent/15 text-accent",
  tag: "border-warning/40 bg-warning/15 text-warning",
  remote: "border-border-strong bg-bg-inset text-fg-subtle",
  stash: "border-purple-500/40 bg-purple-500/15 text-purple-500",
  unknown: "border-border bg-bg-inset text-fg-subtle",
};

const NODE_RADIUS = 6;
const ROW_HEIGHT = DEFAULT_GEOMETRY.rowHeight;
const PADDING_TOP = DEFAULT_GEOMETRY.paddingTop;

export function GitGraph({
  commits,
  selectedCommit,
  onSelectCommit,
  onCommitContextMenu,
  onRefContextMenu,
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
        <p className="mt-1 max-w-sm text-xs text-fg-subtle">{labels.emptyHint}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-bg">
      <div
        ref={scrollRef}
        className="flex-1 overflow-auto"
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
            <svg className="pointer-events-none absolute inset-0 h-full w-full">
              {edges.map((edge, idx) => {
                // Draw every edge overlapping the visible row range so lines
                // stay continuous even when both endpoints are off-screen.
                if (edge.parentIndex < visibleStart || edge.childIndex > visibleEnd) {
                  return null;
                }
                const color = LANE_COLORS[edge.lane % LANE_COLORS.length];
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
              const color = LANE_COLORS[layout.lane % LANE_COLORS.length];
              const isSelected = selectedCommit?.hash === commit.hash;
              return (
                <button
                  key={commit.hash}
                  type="button"
                  onClick={() => onSelectCommit(commit)}
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
                  title={commit.hash}
                  className={`absolute z-10 flex items-center justify-center rounded-full transition-all focus:outline-none ${
                    isSelected ? "scale-125 ring-4 ring-accent/30" : "hover:scale-110"
                  }`}
                >
                  <span
                    className="h-3 w-3 rounded-full border-2 border-bg shadow-md"
                    style={{ backgroundColor: color }}
                  />
                </button>
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
              const isSelected = selectedCommit?.hash === commit.hash;
              return (
                <div
                  key={commit.hash}
                  onClick={() => onSelectCommit(commit)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    onCommitContextMenu?.(commit, e.clientX, e.clientY);
                  }}
                  style={{
                    height: `${ROW_HEIGHT}px`,
                    top: `${layout.y - ROW_HEIGHT / 2}px`,
                  }}
                  className={`absolute left-[100px] right-4 flex cursor-pointer items-center justify-between rounded border px-3 py-1 transition-all ${
                    isSelected
                      ? "border-border-strong bg-bg-elevated text-fg shadow-sm"
                      : "border-transparent text-fg-muted hover:bg-bg-elevated/50 hover:text-fg"
                  }`}
                >
                  <div className="flex items-center space-x-3 overflow-hidden pr-2">
                    <span className="select-all font-mono text-xs font-semibold text-accent">
                      {commit.hash}
                    </span>

                    {commit.refs.map((ref) => {
                      // head / branch / tag / remote are actionable; unknown
                      // refs stay read-only with no context menu.
                      const interactive =
                        ref.kind === "tag" ||
                        ref.kind === "branch" ||
                        ref.kind === "head" ||
                        ref.kind === "remote";
                      const chip = REF_CHIP_STYLES[ref.kind] ?? REF_CHIP_STYLES.branch;
                      return (
                        <span
                          key={`${ref.kind}:${ref.name}`}
                          onClick={(e) => e.stopPropagation()}
                          onContextMenu={
                            interactive
                              ? (e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  onRefContextMenu?.(ref, e.clientX, e.clientY);
                                }
                              : undefined
                          }
                          title={interactive ? labels.refHint.replace("{{name}}", ref.name) : ref.name}
                          className={`flex shrink-0 select-none items-center space-x-0.5 rounded border px-1.5 py-0.5 text-[12px] font-medium ${chip} ${
                            interactive ? "cursor-context-menu" : ""
                          }`}
                        >
                          {ref.kind === "tag" && <Tag className="h-2.5 w-2.5" />}
                          {ref.kind === "head" && <Check className="h-2.5 w-2.5" />}
                          <span>{ref.name}</span>
                        </span>
                      );
                    })}

                    <span className="truncate font-sans text-xs font-medium text-fg">
                      {commit.message}
                    </span>
                  </div>

                  <div className="flex shrink-0 items-center space-x-4 font-mono text-[12px] text-fg-subtle">
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
