import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp, X } from "lucide-react";

/**
 * Minimal slice of the xterm SearchAddon the search bar drives. Keeping it to
 * these three methods lets tests pass a fake and lets the real addon satisfy it
 * structurally.
 */
export interface TerminalSearchController {
  findNext(query: string): boolean;
  findPrevious(query: string): boolean;
  clearDecorations(): void;
}

interface SearchBarProps {
  search: TerminalSearchController;
  onClose: () => void;
}

export function SearchBar({ search, onClose }: SearchBarProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the field as soon as the bar opens so the user can type immediately.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

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
              search.findPrevious(query);
            } else {
              search.findNext(query);
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
        onClick={() => search.findPrevious(query)}
      >
        <ChevronUp size={14} />
      </button>
      <button
        type="button"
        aria-label={t("terminalSearch.next")}
        className={buttonClass}
        onClick={() => search.findNext(query)}
      >
        <ChevronDown size={14} />
      </button>
      <button type="button" aria-label={t("terminalSearch.close")} className={buttonClass} onClick={onClose}>
        <X size={14} />
      </button>
    </div>
  );
}
