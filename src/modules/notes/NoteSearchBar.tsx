import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import type { Editor } from "@tiptap/react";
import {
  noteSearchPluginKey,
  type NoteSearchDecorations,
  type NoteSearchMatch,
} from "./noteSearchHighlight";

export interface NoteSearchResult {
  current: number;
  total: number;
}

export interface NoteSearchController {
  setQuery(query: string): NoteSearchResult;
  findNext(query: string): NoteSearchResult;
  findPrevious(query: string): NoteSearchResult;
  clear(): void;
}

function findMatches(editor: Editor, query: string): NoteSearchMatch[] {
  const needle = query.toLocaleLowerCase();
  if (!needle) {
    return [];
  }

  const matches: NoteSearchMatch[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (!node.isTextblock) {
      return true;
    }
    // Search a whole text block at once so a query can cross inline mark
    // boundaries (for example plain text followed by a bold word).
    const text = node.textBetween(0, node.content.size, "\0", "\0").toLocaleLowerCase();
    let offset = text.indexOf(needle);
    while (offset !== -1) {
      const from = pos + 1 + offset;
      matches.push({ from, to: from + needle.length });
      offset = text.indexOf(needle, offset + needle.length);
    }
    return false;
  });
  return matches;
}

/** Binds search navigation to one live TipTap editor. */
export function createNoteSearchController(editor: Editor): NoteSearchController {
  let query = "";
  let matches: NoteSearchMatch[] = [];
  let active = -1;
  let doc = editor.state.doc;

  const result = (): NoteSearchResult => ({
    current: active < 0 ? 0 : active + 1,
    total: matches.length,
  });

  const paint = () => {
    const update: NoteSearchDecorations = { matches, active };
    editor.view.dispatch(editor.state.tr.setMeta(noteSearchPluginKey, update));
    if (active >= 0) {
      requestAnimationFrame(() => {
        const element = editor.view.dom.querySelector<HTMLElement>("[data-note-search-active]");
        element?.scrollIntoView({ block: "center" });
      });
    }
    return result();
  };

  const refresh = (nextQuery: string) => {
    query = nextQuery;
    doc = editor.state.doc;
    matches = findMatches(editor, nextQuery);
    if (matches.length > 0) {
      const selection = editor.state.selection.from;
      const nextMatch = matches.findIndex((match) => match.from >= selection);
      active = nextMatch >= 0 ? nextMatch : 0;
    } else {
      active = -1;
    }
  };

  const ensureFresh = (nextQuery: string) => {
    if (nextQuery !== query || editor.state.doc !== doc) {
      refresh(nextQuery);
      return true;
    }
    return false;
  };

  return {
    setQuery(nextQuery) {
      refresh(nextQuery);
      return paint();
    },
    findNext(nextQuery) {
      const refreshed = ensureFresh(nextQuery);
      if (!refreshed && matches.length > 0) {
        active = (active + 1) % matches.length;
      }
      return paint();
    },
    findPrevious(nextQuery) {
      const refreshed = ensureFresh(nextQuery);
      if (!refreshed && matches.length > 0) {
        active = (active - 1 + matches.length) % matches.length;
      }
      return paint();
    },
    clear() {
      query = "";
      matches = [];
      active = -1;
      editor.view.dispatch(editor.state.tr.setMeta(noteSearchPluginKey, null));
    },
  };
}

interface NoteSearchBarProps {
  search: NoteSearchController;
  onClose: () => void;
}

export function NoteSearchBar({ search, onClose }: NoteSearchBarProps) {
  const { t } = useTranslation("notes");
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<NoteSearchResult>({ current: 0, total: 0 });
  const inputRef = useRef<HTMLInputElement>(null);
  const queryRef = useRef(query);
  queryRef.current = query;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setResult(search.setQuery(queryRef.current));
    return () => search.clear();
  }, [search]);

  const buttonClass = "rounded p-0.5 text-fg-muted hover:bg-border hover:text-fg";

  return (
    <div className="absolute right-6 top-3 z-20 flex items-center gap-1 rounded-md border border-border-strong bg-bg-elevated px-2 py-1 shadow-lg">
      <input
        ref={inputRef}
        data-note-search-input
        type="text"
        value={query}
        aria-label={t("search.placeholder")}
        placeholder={t("search.placeholder")}
        className="w-44 bg-transparent text-sm text-fg placeholder:text-fg-subtle focus:outline-none"
        onChange={(event) => {
          const nextQuery = event.target.value;
          setQuery(nextQuery);
          setResult(search.setQuery(nextQuery));
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            setResult(
              event.shiftKey ? search.findPrevious(query) : search.findNext(query),
            );
          } else if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
      />
      <span className="min-w-10 text-center text-xs tabular-nums text-fg-subtle">
        {result.current} / {result.total}
      </span>
      <button
        type="button"
        aria-label={t("search.previous")}
        className={buttonClass}
        onClick={() => setResult(search.findPrevious(query))}
      >
        <ChevronUp size={14} />
      </button>
      <button
        type="button"
        aria-label={t("search.next")}
        className={buttonClass}
        onClick={() => setResult(search.findNext(query))}
      >
        <ChevronDown size={14} />
      </button>
      <button type="button" aria-label={t("search.close")} className={buttonClass} onClick={onClose}>
        <X size={14} />
      </button>
    </div>
  );
}
