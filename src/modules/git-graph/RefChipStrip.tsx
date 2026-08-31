import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Tag } from "lucide-react";
import { Tooltip } from "@/components/Tooltip";
import type { CommitRef } from "./types";
import { buildRefChips, type RefChip, type RefChipOptions } from "./lib/refChips";

// Decoration chip styles per ref kind, built from semantic tokens.
export const REF_CHIP_STYLES: Record<string, string> = {
  head: "border-success/40 bg-success/15 text-success",
  branch: "border-accent/40 bg-accent/15 text-accent",
  tag: "border-warning/40 bg-warning/15 text-warning",
  remote: "border-border-strong bg-bg-inset text-fg-subtle",
  stash: "border-purple-500/40 bg-purple-500/15 text-purple-500",
  unknown: "border-border bg-bg-inset text-fg-subtle",
};

// Hover state, only ever applied to the kinds that actually have a menu — a
// read-only decoration lighting up would promise an action that isn't there.
// Deliberately faint: one step of the same colour, no colour change, so that
// dragging the pointer across a row of chips doesn't set off a light show.
const REF_CHIP_HOVER_STYLES: Record<string, string> = {
  head: "hover:border-success/55 hover:bg-success/20",
  branch: "hover:border-accent/55 hover:bg-accent/20",
  tag: "hover:border-warning/55 hover:bg-warning/20",
  // A grey chip has no hue to deepen, so its step is the fill lifting from
  // inset to elevated — a comparable amount of change, just in lightness.
  remote: "hover:border-fg-subtle/40 hover:bg-bg-elevated",
};

export interface RefChipLabels {
  /** "{{name}} — right-click for options" */
  refHint: string;
  /** "{{count}} more refs — click to show" */
  moreRefs: string;
}

type RefMenuHandler = (ref: CommitRef, remotes: CommitRef[], x: number, y: number) => void;

/** head / branch / tag / remote are actionable; the rest are read-only. */
function isInteractive(kind: string): boolean {
  return kind === "tag" || kind === "branch" || kind === "head" || kind === "remote";
}

function Chip({
  chip,
  labels,
  onRefContextMenu,
}: {
  chip: RefChip;
  labels: RefChipLabels;
  onRefContextMenu?: RefMenuHandler;
}) {
  const interactive = isInteractive(chip.ref.kind);
  const style = REF_CHIP_STYLES[chip.ref.kind] ?? REF_CHIP_STYLES.branch;
  return (
    <Tooltip
      label={interactive ? labels.refHint.replace("{{name}}", chip.label) : chip.label}
      className="shrink-0"
    >
      <span
        onClick={(e) => e.stopPropagation()}
        onContextMenu={
          interactive
            ? (e) => {
                e.preventDefault();
                e.stopPropagation();
                onRefContextMenu?.(chip.ref, chip.remotes, e.clientX, e.clientY);
              }
            : undefined
        }
        // leading-4 pins the line box: without it the chip inherits the row's
        // line-height, so the italic remote block's font metrics make a merged
        // chip a hair taller than a plain one sitting next to it.
        className={`flex select-none items-center rounded border text-[12px] font-medium leading-4 transition-colors ${style} ${
          interactive ? `cursor-context-menu ${REF_CHIP_HOVER_STYLES[chip.ref.kind] ?? ""}` : ""
        }`}
      >
        <span className="flex items-center space-x-0.5 px-1.5 py-0.5">
          {chip.ref.kind === "tag" && <Tag className="h-2.5 w-2.5" />}
          {chip.ref.kind === "head" && <Check className="h-2.5 w-2.5" />}
          <span>{chip.ref.name}</span>
        </span>
        {/* Each merged remote gets its own block inside the same chip, so the
            branch and the remotes that carry it read as one thing without a
            separator character having to stand in for the divider. */}
        {chip.remoteNames.map((remote) => (
          <span
            key={remote}
            className="border-l border-current/30 px-1.5 py-0.5 italic"
          >
            {remote}
          </span>
        ))}
      </span>
    </Tooltip>
  );
}

/**
 * The `+N` chip and the list it opens. The list is a portal, like ContextMenu,
 * because the commit row clips its own overflow — and its entries are the same
 * chips as the row's, right-click menus included, so nothing is demoted to a
 * plain text list by being pushed off the row.
 */
function OverflowChips({
  overflow,
  labels,
  onRefContextMenu,
}: {
  overflow: RefChip[];
  labels: RefChipLabels;
  onRefContextMenu?: RefMenuHandler;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ left: 0, top: 0 });

  useLayoutEffect(() => {
    if (!open) {
      return;
    }
    const anchor = buttonRef.current?.getBoundingClientRect();
    const list = listRef.current?.getBoundingClientRect();
    if (!anchor || !list) {
      return;
    }
    const pad = 8;
    const left = Math.max(pad, Math.min(anchor.left, window.innerWidth - list.width - pad));
    const top =
      anchor.bottom + 4 + list.height > window.innerHeight - pad
        ? Math.max(pad, anchor.top - 4 - list.height)
        : anchor.bottom + 4;
    setPos({ left, top });
  }, [open, overflow.length]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const close = () => setOpen(false);
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (listRef.current?.contains(target) || buttonRef.current?.contains(target)) {
        return;
      }
      close();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        close();
      }
    }
    function onScroll(event: Event) {
      // Capture-phase scroll on window sees every descendant's scrolling,
      // including the list's own overflow-y-auto box — and closing on that
      // would put the tail of a long list permanently out of reach.
      if (listRef.current?.contains(event.target as Node)) {
        return;
      }
      close();
    }
    document.addEventListener("mousedown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    // The list is anchored to a row that scrolls away underneath it.
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", close, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", close, true);
    };
  }, [open]);

  return (
    <>
      <Tooltip
        label={labels.moreRefs.replace("{{count}}", String(overflow.length))}
        className="shrink-0"
      >
        <button
          ref={buttonRef}
          type="button"
          aria-haspopup="true"
          aria-expanded={open}
          onClick={(e) => {
            e.stopPropagation();
            setOpen((prev) => !prev);
          }}
          onContextMenu={(e) => {
            // The +N chip is not a ref, so it has no menu of its own — but a
            // right-click on it must not fall through to the row's menu, and
            // ending there as a dead end (having just dismissed whatever menu
            // was open) is worse than simply showing the list.
            e.preventDefault();
            e.stopPropagation();
            setOpen(true);
          }}
          className={`flex select-none items-center rounded border border-border-strong bg-bg-inset px-1.5 py-0.5 text-[12px] font-medium leading-4 text-fg-muted transition-colors hover:border-fg-subtle/40 hover:bg-bg-elevated hover:text-fg ${
            open ? "border-accent text-fg" : ""
          }`}
        >
          +{overflow.length}
        </button>
      </Tooltip>
      {open &&
        createPortal(
          <div
            ref={listRef}
            style={{ position: "fixed", left: pos.left, top: pos.top }}
            onClick={(e) => e.stopPropagation()}
            // Below the tooltip layer (z-100): the chips in here have tooltips
            // of their own, and a list painted over them would hide every one.
            className="z-[95] flex max-h-[50vh] flex-col items-start gap-1 overflow-y-auto rounded-md border border-border-strong bg-bg-elevated p-1.5 shadow-lg"
          >
            {/* The list stays open behind the ref menu it just opened, so the
                other refs are still there to right-click next; the menu paints
                above it (z-200) and the outside-click that picks an item is
                what closes the list. */}
            {overflow.map((chip) => (
              <Chip
                key={chip.key}
                chip={chip}
                labels={labels}
                onRefContextMenu={onRefContextMenu}
              />
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}

/**
 * The ref decorations of one commit row, condensed per the user's Git Graph
 * settings: same-named local/remote branches share a chip, `origin/HEAD` is
 * dropped, and anything past the limit hides behind `+N` so the commit message
 * keeps its room.
 */
export function RefChipStrip({
  refs,
  options,
  labels,
  onRefContextMenu,
}: {
  refs: CommitRef[];
  options: RefChipOptions;
  labels: RefChipLabels;
  onRefContextMenu?: RefMenuHandler;
}) {
  const { chips, overflow } = buildRefChips(refs, options);
  return (
    <>
      {chips.map((chip) => (
        <Chip key={chip.key} chip={chip} labels={labels} onRefContextMenu={onRefContextMenu} />
      ))}
      {overflow.length > 0 && (
        <OverflowChips
          overflow={overflow}
          labels={labels}
          onRefContextMenu={onRefContextMenu}
        />
      )}
    </>
  );
}
