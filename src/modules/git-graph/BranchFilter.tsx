import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";

export interface BranchFilterLabels {
  /** Field label, doubles as the trigger's aria-label (e.g. "Filter"). */
  ariaLabel: string;
  /** The exclusive "no filter" entry (e.g. "Show All"). */
  showAll: string;
  searchPlaceholder: string;
  /** Badge text marking the checked-out branch (e.g. "current"). */
  currentBadge: string;
}

interface BranchFilterProps {
  /** Local branch names, in display order. */
  locals: string[];
  /** Remote branch names; pass an empty list when remotes are hidden. */
  remotes: string[];
  /** Selected branch names; empty means "show all". */
  selected: string[];
  /** The checked-out branch, marked with the current-branch badge in the list. */
  currentBranch?: string;
  onChange: (selected: string[]) => void;
  labels: BranchFilterLabels;
}

/**
 * The graph's branch filter: a fixed-width trigger opening a searchable,
 * multi-select branch list. "Show All" is exclusive (it clears the picks);
 * every other entry toggles independently so several branches can be graphed
 * together. The trigger keeps its width no matter how long the picked branch
 * names are — long values truncate instead of reflowing the toolbar.
 */
export function BranchFilter({
  locals,
  remotes,
  selected,
  currentBranch,
  onChange,
  labels,
}: BranchFilterProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    inputRef.current?.focus();
    function onPointerDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  // Reopening starts from a clean search so the full list is visible again.
  function toggleOpen() {
    setOpen((o) => {
      if (!o) {
        setQuery("");
      }
      return !o;
    });
  }

  function toggleBranch(name: string) {
    onChange(
      selected.includes(name)
        ? selected.filter((s) => s !== name)
        : [...selected, name],
    );
  }

  const filtered = (names: string[]) =>
    query.trim() === ""
      ? names
      : names.filter((n) => n.toLowerCase().includes(query.trim().toLowerCase()));

  const visibleLocals = filtered(locals);
  const visibleRemotes = filtered(remotes);

  const isFiltering = selected.length > 0;
  const triggerText = !isFiltering
    ? labels.showAll
    : selected.length === 1
      ? selected[0]
      : `${selected[0]} +${selected.length - 1}`;

  return (
    <div ref={wrapRef} className="relative w-64 shrink-0">
      <button
        type="button"
        aria-label={labels.ariaLabel}
        aria-expanded={open}
        onClick={toggleOpen}
        className={`flex w-full items-center gap-1 rounded-lg border bg-bg px-2 py-1 text-left text-[13px] ${
          isFiltering ? "border-accent/60 text-accent" : "border-border text-fg-muted"
        }`}
      >
        <span className="min-w-0 flex-1 truncate">{triggerText}</span>
        <ChevronDown
          size={13}
          className={`shrink-0 text-fg-subtle transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1.5 w-full rounded-lg border border-border-strong bg-bg-elevated shadow-xl">
          <div className="flex items-center gap-1.5 border-b border-border px-2 py-1.5">
            <Search size={13} className="shrink-0 text-fg-subtle" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setOpen(false);
                }
              }}
              placeholder={labels.searchPlaceholder}
              spellCheck={false}
              className="min-w-0 flex-1 bg-transparent text-xs text-fg outline-none placeholder:text-fg-subtle"
            />
          </div>
          <ul className="max-h-64 space-y-0.5 overflow-y-auto p-1" role="listbox" aria-multiselectable>
            <FilterRow
              name={labels.showAll}
              checked={!isFiltering}
              onSelect={() => {
                onChange([]);
                setOpen(false);
              }}
            />
            {visibleLocals.length > 0 && <li className="my-1 border-t border-border" aria-hidden="true" />}
            {visibleLocals.map((name) => (
              <FilterRow
                key={name}
                name={name}
                badge={name === currentBranch ? labels.currentBadge : undefined}
                checked={selected.includes(name)}
                onSelect={() => toggleBranch(name)}
              />
            ))}
            {visibleRemotes.length > 0 && <li className="my-1 border-t border-border" aria-hidden="true" />}
            {visibleRemotes.map((name) => (
              <FilterRow
                key={name}
                name={name}
                checked={selected.includes(name)}
                onSelect={() => toggleBranch(name)}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function FilterRow({
  name,
  badge,
  checked,
  onSelect,
}: {
  name: string;
  /** Small marker after the name (the current-branch badge); ✓ is taken by "picked". */
  badge?: string;
  checked: boolean;
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        role="option"
        aria-selected={checked}
        onClick={onSelect}
        className={`flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs ${
          checked ? "bg-bg text-fg" : "text-fg-muted hover:bg-bg hover:text-fg"
        }`}
      >
        <span className="min-w-0 flex-1 truncate">{name}</span>
        {badge && (
          <span className="shrink-0 rounded border border-success/40 bg-success/15 px-1 font-mono text-[10px] text-success">
            {badge}
          </span>
        )}
        {checked && <Check size={13} className="shrink-0 text-accent" />}
      </button>
    </li>
  );
}
