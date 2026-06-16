import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Search } from "lucide-react";
import { fsListFiles } from "./lib/fsBridge";
import { fuzzyRank } from "./lib/fuzzy";
import { useTabsStore } from "@/stores/tabsStore";

interface FileFinderProps {
  root: string;
  onClose: () => void;
}

function relativePath(path: string, root: string): string {
  return path.startsWith(root) ? path.slice(root.length).replace(/^\/+/, "") : path;
}

export function FileFinder({ root, onClose }: FileFinderProps) {
  const { t } = useTranslation("explorer");
  const [query, setQuery] = useState("");
  const [files, setFiles] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const openEditorTab = useTabsStore((s) => s.openEditorTab);

  useEffect(() => {
    inputRef.current?.focus();
    let cancelled = false;
    fsListFiles(root, 20000)
      .then((list) => {
        if (!cancelled) {
          setFiles(list);
        }
      })
      .catch(() => setFiles([]));
    return () => {
      cancelled = true;
    };
  }, [root]);

  const results = useMemo(() => fuzzyRank(query, files).slice(0, 50), [query, files]);

  function open(path: string) {
    openEditorTab(path);
    onClose();
  }

  return (
    <div className="absolute inset-0 z-20 flex justify-center bg-black/40 pt-16">
      <div
        className="h-fit w-[90%] max-w-lg overflow-hidden rounded-lg border border-border-strong bg-bg-elevated shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Search size={15} className="text-fg-subtle" />
          <input
            ref={inputRef}
            value={query}
            placeholder={t("findPlaceholder")}
            aria-label={t("findFiles")}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                onClose();
              } else if (e.key === "Enter" && results[0]) {
                open(results[0]);
              }
            }}
            className="w-full bg-transparent text-sm text-fg outline-none placeholder:text-fg-subtle"
          />
        </div>
        <ul className="max-h-80 overflow-y-auto py-1">
          {results.length === 0 ? (
            <li className="px-3 py-2 text-xs text-fg-subtle">
              {t("noResults")}
            </li>
          ) : (
            results.map((path) => (
              <li key={path}>
                <button
                  type="button"
                  onClick={() => open(path)}
                  className="block w-full truncate px-3 py-1.5 text-left text-sm text-fg-muted hover:bg-bg hover:text-fg"
                >
                  {relativePath(path, root)}
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
      <div className="absolute inset-0 -z-10" onClick={onClose} />
    </div>
  );
}
