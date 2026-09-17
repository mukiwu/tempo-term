import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  DownloadCloud,
  MoreHorizontal,
  RefreshCw,
  Search,
  Settings2,
  X,
} from "lucide-react";
import { Combobox } from "@/components/Combobox";
import { Tooltip } from "@/components/Tooltip";
import { basename } from "@/modules/explorer/lib/paths";
import { BranchFilter } from "./BranchFilter";
import type { WorktreeItem } from "./lib/gitGraphBridge";
import type { Branch, CommitOrder } from "./types";
import { useGraphSearchRequestStore } from "./lib/graphSearchRequestStore";

// Below this measured toolbar width the layout switches to compact: the action
// icons fold into a single overflow menu. Sized to the point where the roomy
// row (branch label + combobox + remote checkbox + four icons + HEAD text) just
// begins to crowd in a split panel.
const COMPACT_WIDTH = 620;

// Two steps before the full compact fold, so the row gives way one control at a
// time instead of holding everything until it breaks. Both only apply once the
// toolbar has actually been measured — an unmeasured toolbar renders roomy.
//
// Below this the worktree picker steps aside. It is the widest control on the
// row and the most reproducible elsewhere: the worktree manager opens the same
// worktrees, so nothing becomes unreachable. Set well above the point where it
// strictly stops fitting — "<folder> (<branch>)" is long enough that keeping it
// to the last possible pixel leaves the row correct but uncomfortably packed.
const WORKTREE_WIDTH = 1000;
// Below this the "HEAD: <branch>" button goes altogether rather than shrinking
// to an icon: right-clicking a branch chip in the graph already offers checkout,
// and below COMPACT_WIDTH the overflow menu carries the button again. An icon
// here would only be a second, wordless door to something already reachable.
const HEAD_BUTTON_WIDTH = 900;

// What an open search takes out of the row, so the thresholds above see what is
// left rather than each growing a search-aware twin. Both are net of the "HEAD:
// <branch>" label COMPACT_WIDTH allows for, which needs 900 and is long gone by
// the time search is asking for room — charging full width on top of that
// allowance folds controls away and leaves the gap they sat in.
const SEARCH_WIDTH = 230;
// Typing adds the counts and the two step buttons; at some widths that is the
// difference between fitting and not.
const SEARCH_MATCHES_WIDTH = 60;

interface WorktreeOption {
  label: string;
  path: string;
}

/** "basename (branch)" per worktree; colliding labels fall back to the full
 * path so every Combobox option string stays unique (selection maps back by
 * string value). */
function buildWorktreeOptions(worktrees: WorktreeItem[]): WorktreeOption[] {
  const base = worktrees.map((w) => ({
    label: w.branch ? `${basename(w.path)} (${w.branch})` : basename(w.path),
    path: w.path,
  }));
  const counts = new Map<string, number>();
  for (const option of base) {
    counts.set(option.label, (counts.get(option.label) ?? 0) + 1);
  }
  return base.map((option) =>
    (counts.get(option.label) ?? 0) > 1 ? { ...option, label: option.path } : option,
  );
}

/** Separator- and trailing-slash-insensitive path equality: git prints
 * forward slashes while Windows system paths may carry backslashes, and
 * resolve_repo trims the trailing slash git keeps. */
function samePath(a: string, b: string): boolean {
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
  return norm(a) === norm(b);
}

export interface GitGraphToolbarLabels {
  branches: string;
  showAll: string;
  filterPlaceholder: string;
  /** Badge marking the checked-out branch in the filter list. Deliberately NOT
   * "HEAD": the graph rows already show an `origin/HEAD` ref chip, and two
   * HEAD-ish labels with different meanings read as the same thing. */
  currentBadge: string;
  showRemoteBranches: string;
  search: string;
  /** The X beside the open input. Not `search` reused: one opens the box and
   * the other closes it, and a screen reader would hear the same name twice. */
  closeSearch: string;
  searchPlaceholder: string;
  displayOptions: string;
  showTags: string;
  showStashes: string;
  refresh: string;
  fetch: string;
  fetching: string;
  matches: string;
  /** The counts alone; `matches` is the sentence, shown on hover. */
  matchesShort: string;
  previousMatch: string;
  nextMatch: string;
  head: string;
  more: string;
  commitOrder: string;
  orderDate: string;
  orderTopo: string;
  worktree: string;
  switchBranch: string;
}

interface GitGraphToolbarProps {
  branches: Branch[];
  /** Branch names the graph is filtered to; empty means Show All. */
  selectedBranches: string[];
  onSelectBranches: (branches: string[]) => void;
  includeRemotes: boolean;
  onToggleRemotes: (value: boolean) => void;
  includeTags: boolean;
  onToggleTags: (value: boolean) => void;
  includeStashes: boolean;
  onToggleStashes: (value: boolean) => void;
  commitOrder: CommitOrder;
  onChangeOrder: (order: CommitOrder) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  /** One-based position of the selected commit in the matches, or zero. */
  matchPosition: number;
  matchCount: number;
  onNavigateMatch: (direction: "next" | "previous") => void;
  onRefresh: () => void;
  onFetch: () => void;
  fetching: boolean;
  refreshing: boolean;
  currentBranch: string;
  worktrees: WorktreeItem[];
  currentWorktreePath: string | null;
  onSelectWorktree: (path: string) => void;
  onCheckoutBranch: (name: string) => void;
  onCheckoutRemoteBranch: (name: string) => void;
  labels: GitGraphToolbarLabels;
}

export function GitGraphToolbar({
  branches,
  selectedBranches,
  onSelectBranches,
  includeRemotes,
  onToggleRemotes,
  includeTags,
  onToggleTags,
  includeStashes,
  onToggleStashes,
  commitOrder,
  onChangeOrder,
  searchQuery,
  onSearchChange,
  matchPosition,
  matchCount,
  onNavigateMatch,
  onRefresh,
  onFetch,
  fetching,
  refreshing,
  currentBranch,
  worktrees,
  currentWorktreePath,
  onSelectWorktree,
  onCheckoutBranch,
  onCheckoutRemoteBranch,
  labels,
}: GitGraphToolbarProps) {
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [branchMenuOpen, setBranchMenuOpen] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);

  // Ctrl/Cmd+F, routed through a store because the shortcut is handled at the
  // window and the box's open state lives here. Keyed on the token changing,
  // not on its value, so a request that arrived before this toolbar mounted
  // does not pop the box open on arrival.
  const searchRequest = useGraphSearchRequestStore((s) => s.token);
  const seenSearchRequest = useRef(searchRequest);
  const searchInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (searchRequest === seenSearchRequest.current) {
      return;
    }
    seenSearchRequest.current = searchRequest;
    setSearchOpen(true);
    // Already open: select what is there, the way a browser's find bar does, so
    // the next keystroke replaces the query instead of appending to it.
    searchInputRef.current?.select();
  }, [searchRequest]);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const measured = entries[0]?.contentRect.width;
      if (typeof measured === "number") {
        setWidth(measured);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Reads the query, not `isCompact`, so the charge cannot depend on the answer
  // it is used to compute.
  const searchCost = !searchOpen
    ? 0
    : SEARCH_WIDTH + (searchQuery.trim() === "" ? 0 : SEARCH_MATCHES_WIDTH);
  const usableWidth = width === null ? null : width - searchCost;
  // Search opens in the right-hand group, so only that group pays for it —
  // folding something on the left gives a box on the right no pixel it can use,
  // it only moves the gap. Left-hand controls test the row's own width.
  const isCompact = usableWidth !== null && usableWidth < COMPACT_WIDTH;
  const isNarrow = width !== null && width < COMPACT_WIDTH;
  // Unmeasured (width === null) counts as roomy, same as isCompact above, so
  // the first paint never flashes a collapsed row.
  const hasRoomForWorktree = width === null || width >= WORKTREE_WIDTH;
  const hasRoomForHeadButton = usableWidth === null || usableWidth >= HEAD_BUTTON_WIDTH;

  const locals = branches.filter((b) => !b.isRemote);
  const remotes = branches.filter((b) => b.isRemote);

  // The filter list puts recently-active branches first — with hundreds of
  // branches the one being looked for is almost always fresh. Name breaks
  // timestamp ties so the order stays stable.
  const byRecency = (a: Branch, b: Branch) =>
    (b.lastCommitAt ?? 0) - (a.lastCommitAt ?? 0) || a.name.localeCompare(b.name);
  const filterLocals = [...locals].sort(byRecency).map((b) => b.name);
  const filterRemotes = includeRemotes
    ? [...remotes].sort(byRecency).map((b) => b.name)
    : [];

  // Toggles render either as the gear popover (roomy) or rows in the overflow
  // menu (compact). Remote-branches lives here too once the toolbar is compact.
  const toggles: ToggleRowProps[] = [
    { label: labels.showTags, checked: includeTags, onChange: onToggleTags },
    { label: labels.showStashes, checked: includeStashes, onChange: onToggleStashes },
  ];

  const orderOptions: { value: CommitOrder; label: string }[] = [
    { value: "date", label: labels.orderDate },
    { value: "topo", label: labels.orderTopo },
  ];
  const orderSection = (
    <>
      <div className="my-1 border-t border-border" />
      <div
        className="px-2 py-1 font-mono text-[11px] text-fg-subtle"
        aria-hidden="true"
      >
        {labels.commitOrder}
      </div>
      <div role="radiogroup" aria-label={labels.commitOrder}>
        {orderOptions.map((o) => (
          <OrderRow
            key={o.value}
            label={o.label}
            checked={commitOrder === o.value}
            onSelect={() => onChangeOrder(o.value)}
          />
        ))}
      </div>
    </>
  );

  // The branch combobox used to step aside for an open search on a narrow row.
  // It no longer does: it ellipsizes instead, as it already does for a long
  // branch name — and narrowing a search to one branch is the likeliest next
  // thing the reader wants.

  const worktreeOptions = buildWorktreeOptions(worktrees);
  const currentWorktree =
    currentWorktreePath === null
      ? undefined
      : worktreeOptions.find((o) => samePath(o.path, currentWorktreePath));
  // A single-worktree repo (the common case) hides the control entirely, and so
  // does a row too narrow to carry it.
  const showWorktreeControls = hasRoomForWorktree && worktreeOptions.length > 1;
  const worktreeValue =
    currentWorktree?.label ?? (currentWorktreePath ? basename(currentWorktreePath) : "");

  // Drops the query with the box: a search left running behind a closed input
  // is a filter nobody can see.
  const closeSearch = () => {
    onSearchChange("");
    setSearchOpen(false);
  };

  // git refuses `git checkout <branch>` for a branch some other worktree has
  // checked out — disable those menu entries and show where each one lives.
  const branchesInOtherWorktrees = new Map<string, string>();
  for (const w of worktrees) {
    if (w.branch && (!currentWorktreePath || !samePath(w.path, currentWorktreePath))) {
      branchesInOtherWorktrees.set(w.branch, basename(w.path));
    }
  }

  const switchBranchLabel = `${labels.switchBranch} (${labels.head}: ${currentBranch})`;
  const branchMenu = branchMenuOpen ? (
    <BranchMenu
      locals={locals}
      remotes={remotes}
      currentBranch={currentBranch}
      branchesInOtherWorktrees={branchesInOtherWorktrees}
      onCheckoutBranch={onCheckoutBranch}
      onCheckoutRemoteBranch={onCheckoutRemoteBranch}
      onClose={() => setBranchMenuOpen(false)}
    />
  ) : null;

  return (
    <div
      ref={rootRef}
      className="relative flex items-center justify-between gap-3 rounded-lg border border-border bg-bg-inset px-3 py-2"
    >
      {/* 左側：分支下拉 + 遠端開關（compact 時遠端開關移進 ⋯ 選單） */}
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex min-w-0 items-center gap-1.5 text-xs text-fg-subtle">
          <span className="shrink-0">{labels.branches}:</span>
          <BranchFilter
            locals={filterLocals}
            remotes={filterRemotes}
            selected={selectedBranches}
            currentBranch={currentBranch}
            onChange={onSelectBranches}
            labels={{
              ariaLabel: labels.branches,
              showAll: labels.showAll,
              searchPlaceholder: labels.filterPlaceholder,
              currentBadge: labels.currentBadge,
            }}
          />
        </div>

        {showWorktreeControls && (
          <div className="flex min-w-0 items-center gap-1.5 text-xs text-fg-subtle">
            <span className="shrink-0">{labels.worktree}:</span>
            {/* The value is "<folder> (<branch>)", so a long branch name makes
                this the widest thing on the row. It used to opt out of clipping
                entirely, which dropped the ellipsis *and* the overflow guard
                that comes with it — the text then painted straight over the
                remote-branches checkbox beside it.

                The bounds belong on this wrapper, not on the Combobox: the
                wrapper is the flex item, so it is what the row measures and
                makes space for. Bounding only the inner box let it outgrow the
                wrapper and paint over a neighbour the layout still believed had
                room. The floor keeps the picker readable instead of letting it
                collapse to its chevron; the full value is on hover. */}
            <Tooltip label={worktreeValue} className="min-w-[8rem] max-w-[14rem]">
              <Combobox
                value={worktreeValue}
                options={worktreeOptions.map((o) => o.label)}
                onChange={(label) => {
                  const picked = worktreeOptions.find((o) => o.label === label);
                  if (
                    picked &&
                    (!currentWorktree || !samePath(picked.path, currentWorktree.path))
                  ) {
                    onSelectWorktree(picked.path);
                  }
                }}
                ariaLabel={labels.worktree}
                // Matched to the branch filter's trigger sitting right next to
                // it — same radius, border, padding and type size, so the two
                // read as one pair of controls, not two unrelated boxes.
                size="sm"
                fieldClassName="px-2 py-1"
                textClassName="text-[13px]"
                // Fill the wrapper, which is where the bounds live, and keep
                // min-w-0 so the trigger text can ellipsize instead of holding
                // a min-content floor and pushing back out through it.
                className="min-w-0 flex-1"
              />
            </Tooltip>
          </div>
        )}

        {!isNarrow && (
          // shrink-0 + nowrap: squeezed, this label used to wrap mid-word, and
          // the second line grew the whole row — which read as the icons on the
          // right sitting too high rather than as a wrapped label. It keeps its
          // width now; below COMPACT_WIDTH it moves into the overflow menu.
          <label className="flex shrink-0 cursor-pointer select-none items-center gap-1.5 whitespace-nowrap text-xs text-fg-muted">
            <input
              type="checkbox"
              checked={includeRemotes}
              onChange={(e) => onToggleRemotes(e.target.checked)}
              className="shrink-0 accent-accent"
            />
            <span>{labels.showRemoteBranches}</span>
          </label>
        )}
      </div>

      {/* 右側：搜尋一直在；其餘 compact 時收進 ⋯ */}
      <div className="flex min-w-0 items-center gap-0.5">
        {searchOpen ? (
          <div className="flex min-w-0 items-center gap-1">
            <input
              ref={searchInputRef}
              autoFocus
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              onKeyDown={(event) => {
                // A composition owns both keys: Enter commits the candidate and
                // Escape cancels it. Neither is meant for the search box.
                if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) {
                  return;
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  closeSearch();
                  return;
                }
                if (event.key !== "Enter") {
                  return;
                }
                event.preventDefault();
                onNavigateMatch(event.shiftKey ? "previous" : "next");
              }}
              placeholder={labels.searchPlaceholder}
              className="w-52 min-w-0 rounded border border-border-strong bg-bg px-2 py-1 text-xs text-fg focus:outline-none focus:ring-1 focus:ring-accent"
            />
            {searchQuery.trim() !== "" && (
              <>
                {/* Numbers inline, the sentence on hover: spelling out
                    "(loaded)" costs about what the remote toggle beside it
                    costs, and it is read once where the counts are read every
                    keystroke. */}
                <Tooltip
                  label={labels.matches
                    .replace("{{current}}", String(matchPosition))
                    .replace("{{count}}", String(matchCount))}
                  className="shrink-0"
                >
                  <span className="whitespace-nowrap font-mono text-[11px] text-fg-subtle">
                    {labels.matchesShort
                      .replace("{{current}}", String(matchPosition))
                      .replace("{{count}}", String(matchCount))}
                  </span>
                </Tooltip>
                <Tooltip label={labels.previousMatch}>
                  <button
                    type="button"
                    aria-label={labels.previousMatch}
                    disabled={matchCount === 0}
                    onClick={() => onNavigateMatch("previous")}
                    className="shrink-0 rounded p-1 text-fg-subtle hover:bg-bg-elevated hover:text-fg disabled:cursor-default disabled:opacity-40"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                </Tooltip>
                <Tooltip label={labels.nextMatch}>
                  <button
                    type="button"
                    aria-label={labels.nextMatch}
                    disabled={matchCount === 0}
                    onClick={() => onNavigateMatch("next")}
                    className="shrink-0 rounded p-1 text-fg-subtle hover:bg-bg-elevated hover:text-fg disabled:cursor-default disabled:opacity-40"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                </Tooltip>
              </>
            )}
            <Tooltip label={labels.closeSearch}>
              <button
                type="button"
                aria-label={labels.closeSearch}
                onClick={closeSearch}
                className="shrink-0 rounded p-1 text-fg-subtle hover:bg-bg-elevated hover:text-fg"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </Tooltip>
          </div>
        ) : (
          <Tooltip label={labels.search}>
            <button
              type="button"
              aria-label={labels.search}
              onClick={() => setSearchOpen(true)}
              className="shrink-0 rounded p-1.5 text-fg-subtle hover:bg-bg-elevated hover:text-fg"
            >
              <Search className="h-4 w-4" />
            </button>
          </Tooltip>
        )}

        {isCompact ? (
          // flex, not a plain block: the Tooltip wrapper is inline-flex, and an
          // inline box in a block sits on the text baseline with the strut's
          // descender space left under it. That padded the wrapper a few px
          // taller than the icon, and items-center then centred the wrapper —
          // leaving this icon riding higher than its unwrapped neighbours.
          <div className="relative flex items-center">
            <Tooltip label={labels.more}>
              <button
                type="button"
                aria-label={labels.more}
                aria-expanded={overflowOpen}
                onClick={() => setOverflowOpen((v) => !v)}
                className="shrink-0 rounded p-1.5 text-fg-subtle hover:bg-bg-elevated hover:text-fg"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </Tooltip>
            {overflowOpen && (
              <>
                <div
                  className="fixed inset-0 z-20"
                  onClick={() => setOverflowOpen(false)}
                  aria-hidden="true"
                />
                {/* top-full, not the static position: the wrapper is a flex
                    container, and a flex container aligns an absolutely
                    positioned child's static position with align-items — so
                    `items-center` would hang this menu off the button's
                    midpoint and float it up over the tab bar. */}
                <div className="absolute right-0 top-full z-30 mt-1 w-52 rounded-md border border-border-strong bg-bg-elevated p-1 shadow-lg">
                  <button
                    type="button"
                    aria-label={switchBranchLabel}
                    disabled={branches.length === 0}
                    onClick={() => {
                      setOverflowOpen(false);
                      setBranchMenuOpen(true);
                    }}
                    className="flex w-full items-center rounded px-2 py-1.5 text-left font-mono text-[11px] text-fg-subtle hover:bg-bg-inset hover:text-fg disabled:opacity-50"
                  >
                    {labels.head}: {currentBranch}
                  </button>
                  <ActionRow
                    icon={
                      <RefreshCw
                        className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`}
                      />
                    }
                    label={labels.refresh}
                    disabled={refreshing}
                    onClick={() => {
                      setOverflowOpen(false);
                      onRefresh();
                    }}
                  />
                  <ActionRow
                    icon={
                      <DownloadCloud
                        className={`h-3.5 w-3.5 ${fetching ? "animate-pulse" : ""}`}
                      />
                    }
                    label={fetching ? labels.fetching : labels.fetch}
                    disabled={fetching}
                    onClick={() => {
                      setOverflowOpen(false);
                      onFetch();
                    }}
                  />
                  <div className="my-1 border-t border-border" />
                  <ToggleRow
                    label={labels.showRemoteBranches}
                    checked={includeRemotes}
                    onChange={onToggleRemotes}
                  />
                  {toggles.map((t) => (
                    <ToggleRow key={t.label} {...t} />
                  ))}
                  {orderSection}
                </div>
              </>
            )}
            {branchMenu}
          </div>
        ) : (
          <>
            <div className="relative flex items-center">
              <Tooltip label={labels.displayOptions}>
                <button
                  type="button"
                  aria-label={labels.displayOptions}
                  onClick={() => setOptionsOpen((v) => !v)}
                  className="shrink-0 rounded p-1.5 text-fg-subtle hover:bg-bg-elevated hover:text-fg"
                >
                  <Settings2 className="h-4 w-4" />
                </button>
              </Tooltip>
              {optionsOpen && (
                <>
                  <div
                    className="fixed inset-0 z-20"
                    onClick={() => setOptionsOpen(false)}
                    aria-hidden="true"
                  />
                  <div className="absolute right-0 top-full z-30 mt-1 w-48 rounded-md border border-border-strong bg-bg-elevated p-1 shadow-lg">
                    {toggles.map((t) => (
                      <ToggleRow key={t.label} {...t} />
                    ))}
                    {orderSection}
                  </div>
                </>
              )}
            </div>

            <Tooltip label={labels.refresh}>
              <button
                type="button"
                aria-label={labels.refresh}
                onClick={onRefresh}
                disabled={refreshing}
                className="rounded p-1.5 text-fg-subtle hover:bg-bg-elevated hover:text-fg disabled:opacity-50"
              >
                <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
              </button>
            </Tooltip>

            <Tooltip label={fetching ? labels.fetching : labels.fetch}>
              <button
                type="button"
                aria-label={fetching ? labels.fetching : labels.fetch}
                onClick={onFetch}
                disabled={fetching}
                className="rounded p-1.5 text-fg-subtle hover:bg-bg-elevated hover:text-fg disabled:opacity-50"
              >
                <DownloadCloud className={`h-4 w-4 ${fetching ? "animate-pulse" : ""}`} />
              </button>
            </Tooltip>

            {hasRoomForHeadButton && (
              <div className="relative flex items-center">
                {/* The tooltip carries the branch name in full, so a long one
                    stays readable once the label itself is ellipsized. */}
                <Tooltip label={switchBranchLabel}>
                  <button
                    type="button"
                    aria-label={switchBranchLabel}
                    aria-expanded={branchMenuOpen}
                    disabled={branches.length === 0}
                    onClick={() => setBranchMenuOpen((v) => !v)}
                    className="ml-1 max-w-[14rem] truncate rounded px-1 py-0.5 font-mono text-[11px] text-fg-subtle hover:bg-bg-elevated hover:text-fg disabled:opacity-50"
                  >
                    {labels.head}: {currentBranch}
                  </button>
                </Tooltip>
                {branchMenu}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

interface ToggleRowProps {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}

function ToggleRow({ label, checked, onChange }: ToggleRowProps) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs text-fg-muted hover:bg-bg-inset hover:text-fg"
    >
      <span>{label}</span>
      {checked && <Check className="h-3.5 w-3.5 text-accent" />}
    </button>
  );
}

interface OrderRowProps {
  label: string;
  checked: boolean;
  onSelect: () => void;
}

function OrderRow({ label, checked, onSelect }: OrderRowProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onSelect}
      className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs text-fg-muted hover:bg-bg-inset hover:text-fg"
    >
      <span>{label}</span>
      {checked && <Check className="h-3.5 w-3.5 text-accent" />}
    </button>
  );
}

interface ActionRowProps {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

function ActionRow({ icon, label, onClick, disabled = false }: ActionRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-fg-muted hover:bg-bg-inset hover:text-fg disabled:opacity-50"
    >
      <span className="text-fg-subtle">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

interface BranchMenuProps {
  locals: Branch[];
  remotes: Branch[];
  currentBranch: string;
  /** Branch name -> basename of the other worktree that has it checked out.
   * git refuses to check these out here, so their entries are disabled. */
  branchesInOtherWorktrees: Map<string, string>;
  onCheckoutBranch: (name: string) => void;
  onCheckoutRemoteBranch: (name: string) => void;
  onClose: () => void;
}

/** The checkout popover behind the HEAD display. Locals check out directly;
 * remotes route to the create-tracking-branch modal owned by the tab. */
function BranchMenu({
  locals,
  remotes,
  currentBranch,
  branchesInOtherWorktrees,
  onCheckoutBranch,
  onCheckoutRemoteBranch,
  onClose,
}: BranchMenuProps) {
  return (
    <>
      <div className="fixed inset-0 z-20" onClick={onClose} aria-hidden="true" />
      <div
        role="menu"
        className="absolute right-0 top-full z-30 mt-1 max-h-72 w-56 overflow-y-auto rounded-md border border-border-strong bg-bg-elevated p-1 shadow-lg"
      >
        {locals.map((b) => {
          const otherWorktree =
            b.name === currentBranch ? undefined : branchesInOtherWorktrees.get(b.name);
          return (
            <button
              key={b.name}
              type="button"
              role="menuitem"
              disabled={otherWorktree !== undefined}
              onClick={() => {
                onClose();
                if (b.name !== currentBranch) {
                  onCheckoutBranch(b.name);
                }
              }}
              className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs text-fg-muted hover:bg-bg-inset hover:text-fg disabled:opacity-50 disabled:hover:bg-transparent"
            >
              <span className="truncate font-mono">{b.name}</span>
              {b.name === currentBranch && (
                <Check className="h-3.5 w-3.5 shrink-0 text-accent" />
              )}
              {otherWorktree !== undefined && (
                <span className="shrink-0 text-[10px] text-fg-subtle">{otherWorktree}</span>
              )}
            </button>
          );
        })}
        {remotes.length > 0 && (
          <>
            <div className="my-1 border-t border-border" />
            {remotes.map((b) => (
              <button
                key={b.name}
                type="button"
                role="menuitem"
                onClick={() => {
                  onClose();
                  onCheckoutRemoteBranch(b.name);
                }}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-fg-muted hover:bg-bg-inset hover:text-fg"
              >
                <span className="truncate font-mono">{b.name}</span>
              </button>
            ))}
          </>
        )}
      </div>
    </>
  );
}
