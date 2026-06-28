import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import type { ISearchOptions } from "@xterm/addon-search";

/**
 * Minimal slice of the xterm SearchAddon the search bar drives. Keeping it to
 * these three methods lets tests pass a fake and lets the real addon satisfy it
 * structurally.
 */
export interface TerminalSearchController {
  findNext(query: string, options?: ISearchOptions): boolean;
  findPrevious(query: string, options?: ISearchOptions): boolean;
  clearDecorations(): void;
}

/**
 * Muted gold match colours. Decorations only set the cell background (xterm
 * can't recolour the matched text), so the fill is kept a desaturated mid-tone
 * gold: bright enough to spot, dark enough that light terminal text stays
 * readable on top, and easy on the eyes. The active match is a lighter gold so
 * the focused hit still stands out from the rest.
 */
const SEARCH_OPTIONS: ISearchOptions = {
  decorations: {
    matchBackground: "#9d8136",
    matchBorder: "#b59a45",
    matchOverviewRuler: "#b59a45",
    activeMatchBackground: "#c0a046",
    activeMatchBorder: "#d8b65e",
    activeMatchColorOverviewRuler: "#d8b65e",
  },
};

interface SearchBarProps {
  search: TerminalSearchController;
  onClose: () => void;
}

export function SearchBar({ search, onClose }: SearchBarProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const initialMount = useRef(true);

  // Focus the field as soon as the bar opens so the user can type immediately.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Clear stale highlights the moment the query is emptied, rather than leaving
  // them on screen until the bar closes. Skips the initial empty mount.
  useEffect(() => {
    if (initialMount.current) {
      initialMount.current = false;
      return;
    }
    if (!query) {
      search.clearDecorations();
    }
  }, [query, search]);

  // Drop the match highlight when the bar goes away, so closing search leaves
  // the terminal clean.
  useEffect(() => () => search.clearDecorations(), [search]);

  const buttonClass = "rounded p-0.5 text-fg-muted hover:bg-border hover:text-fg";

  return (
    <div className="absolute right-3 top-3 z-20 flex items-center gap-1 rounded-md border border-border-strong bg-bg-elevated px-2 py-1 shadow-lg">
      <input
        ref={inputRef}
        type="text"
        value={query}
        placeholder={t("terminalSearch.placeholder")}
        className="w-44 bg-transparent text-sm text-fg placeholder-fg-subtle focus:outline-none"
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            if (event.shiftKey) {
              search.findPrevious(query, SEARCH_OPTIONS);
            } else {
              search.findNext(query, SEARCH_OPTIONS);
            }
          } else if (event.key === "Escape") {
            onClose();
          }
        }}
      />
      <button
        type="button"
        aria-label={t("terminalSearch.previous")}
        className={buttonClass}
        onClick={() => search.findPrevious(query, SEARCH_OPTIONS)}
      >
        <ChevronUp size={14} />
      </button>
      <button
        type="button"
        aria-label={t("terminalSearch.next")}
        className={buttonClass}
        onClick={() => search.findNext(query, SEARCH_OPTIONS)}
      >
        <ChevronDown size={14} />
      </button>
      <button type="button" aria-label={t("terminalSearch.close")} className={buttonClass} onClick={onClose}>
        <X size={14} />
      </button>
    </div>
  );
}
