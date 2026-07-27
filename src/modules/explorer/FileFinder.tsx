import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Search } from "lucide-react";
import { fsListFiles } from "./lib/fsBridge";
import { fuzzyRank } from "./lib/fuzzy";
import { basename, relativeDirOf, relativePath } from "./lib/paths";
import { useRecentFilesStore } from "./lib/recentFiles";
import { FileIcon } from "./components/FileIcon";
import { InfoDialog } from "@/components/InfoDialog";
import { useOverlayGuard } from "@/lib/overlayGuard";
import { matchesNewTabModifier } from "@/lib/platform";
import { useTabsStore } from "@/stores/tabsStore";

interface FileFinderProps {
  root: string;
  onClose: () => void;
}

/**
 * Global fuzzy file search palette (Cmd/Ctrl+P), mounted at the app level so it
 * opens over whatever the user is looking at rather than being scoped to the
 * Explorer sidebar. Anchored near the top of the window and full-width (unlike
 * the old sidebar-embedded version), so a matched file's full relative path is
 * always visible without truncation or a hover tooltip.
 */
export function FileFinder({ root, onClose }: FileFinderProps) {
  const { t } = useTranslation("explorer");
  const { t: tCommon } = useTranslation("common");
  const [query, setQuery] = useState("");
  const [files, setFiles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [atCapacity, setAtCapacity] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeResultRef = useRef<HTMLButtonElement | null>(null);
  const openFromSidebar = useTabsStore((s) => s.openFromSidebar);
  const openInNewTab = useTabsStore((s) => s.openInNewTab);
  const recentPaths = useRecentFilesStore((s) => s.paths);
  const addRecent = useRecentFilesStore((s) => s.addRecent);

  // A full-screen overlay, so hide the native preview webview (which floats
  // above all DOM) for as long as this is mounted.
  useOverlayGuard(true);

  useEffect(() => {
    inputRef.current?.focus();
    let cancelled = false;
    setLoading(true);
    fsListFiles(root, 20000)
      .then((list) => {
        if (!cancelled) {
          setFiles(list);
        }
      })
      .catch(() => setFiles([]))
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [root]);

  // A Set lookup keeps this O(files + recents) instead of O(files * recents) —
  // `files` can hold up to 20,000 entries (see the fsListFiles call below).
  const fileSet = useMemo(() => new Set(files), [files]);

  // Recent picks still under this root, most-recently-opened first; a path
  // that was deleted or belongs to a different workspace silently drops off
  // since it no longer appears in `files`.
  const recentResults = useMemo(
    () => recentPaths.filter((path) => fileSet.has(path)),
    [recentPaths, fileSet],
  );
  const showRecent = query === "" && recentResults.length > 0;

  // Match against each file's path *relative to the workspace root*, not the
  // raw absolute path `fsListFiles` returns. Matching the absolute path lets
  // segments entirely outside the project (e.g. "Documents" in the user's
  // home directory, which already contains "d","o","c","s" in order followed
  // by a "/") satisfy a query like "docs/" for every single file in the
  // workspace, regardless of where it actually lives relative to the root.
  const { relativePaths, relativeToPath } = useMemo(() => {
    const paths: string[] = [];
    const toPath = new Map<string, string>();
    for (const path of files) {
      const relative = relativePath(path, root);
      paths.push(relative);
      toPath.set(relative, path);
    }
    return { relativePaths: paths, relativeToPath: toPath };
  }, [files, root]);

  const results = useMemo(() => {
    if (showRecent) {
      return recentResults;
    }
    const rankedRelatives = fuzzyRank(query, relativePaths).slice(0, 50);
    return rankedRelatives.map((relative) => relativeToPath.get(relative)!);
  }, [query, relativePaths, relativeToPath, showRecent, recentResults]);

  // The result set changes on every keystroke; keep the highlighted row
  // pinned to the top match instead of an index that now points elsewhere.
  useEffect(() => {
    setActiveIndex(0);
  }, [results]);

  useEffect(() => {
    activeResultRef.current?.scrollIntoView({ block: "nearest" });
    // A query change can leave activeIndex at the same value (still 0) while
    // the list itself re-filters, e.g. after the user wheel-scrolled away
    // from the top — results must stay in the dependency list so that case
    // still re-scrolls back to the active row.
  }, [activeIndex, results]);

  /** `newTab` mirrors the file tree's Cmd/Ctrl gesture, on click and on Enter. */
  function open(path: string, newTab = false) {
    const result = newTab
      ? openInNewTab({ kind: "editor", path })
      : openFromSidebar({ kind: "editor", path });
    if (result.status === "at-capacity") {
      setAtCapacity(true);
      return;
    }
    addRecent(path);
    onClose();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    // While an IME candidate window is open, Enter (and often the arrow keys)
    // commit/navigate the candidate, not this list — let them through.
    if (e.nativeEvent.isComposing || e.keyCode === 229) {
      return;
    }
    if (e.key === "Escape") {
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (results.length ? (i + 1) % results.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (results.length ? (i - 1 + results.length) % results.length : 0));
    } else if (e.key === "Enter" && results[activeIndex]) {
      open(results[activeIndex], matchesNewTabModifier(e));
    }
  }

  return (
    <div
      className="fixed inset-0 z-[90] flex justify-center bg-black/40 pt-16"
      // Clicking the dimmed area beside the panel dismisses it; clicks that
      // originate inside the panel (or the at-capacity InfoDialog, which is a
      // descendant of this wrapper too) bubble up here with a different
      // target, so guard on currentTarget to leave those alone — otherwise
      // dismissing the InfoDialog would also close this palette underneath it.
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="h-fit w-[90%] max-w-2xl overflow-hidden rounded-lg border border-border-strong bg-bg-elevated shadow-2xl md:w-[70%]">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
          <Search size={16} className="shrink-0 text-fg-subtle" />
          <input
            ref={inputRef}
            value={query}
            placeholder={t("findPlaceholder")}
            aria-label={t("findFiles")}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            className="w-full bg-transparent text-sm text-fg outline-none placeholder:text-fg-subtle"
          />
        </div>
        <ul className="max-h-96 overflow-y-auto py-1">
          {loading ? (
            <li className="px-3 py-2 text-xs text-fg-subtle">{t("loading")}</li>
          ) : results.length === 0 ? (
            <li className="px-3 py-2 text-xs text-fg-subtle">{t("noResults")}</li>
          ) : (
            <>
              {showRecent && (
                <li
                  aria-hidden="true"
                  className="px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-fg-subtle"
                >
                  {t("recentlyOpened")}
                </li>
              )}
              {results.map((path, index) => {
                const relative = relativePath(path, root);
                const name = basename(path);
                const dir = relativeDirOf(relative);
                const active = index === activeIndex;
                return (
                  <li key={path}>
                    <button
                      ref={active ? activeResultRef : undefined}
                      type="button"
                      onClick={(event) => open(path, matchesNewTabModifier(event))}
                      // mousemove, not mouseenter: keyboard-driven scrolling
                      // can slide a row under a stationary cursor, and a plain
                      // enter there would steal the selection from the keyboard.
                      // Guarded so merely wiggling the cursor over an already-
                      // active row doesn't re-fire a state update per pixel.
                      onMouseMove={() => {
                        if (activeIndex !== index) {
                          setActiveIndex(index);
                        }
                      }}
                      aria-selected={active}
                      className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm ${
                        active ? "bg-bg text-fg" : "text-fg-muted hover:bg-bg hover:text-fg"
                      }`}
                    >
                      <FileIcon name={name} isDir={false} />
                      <span className="min-w-0 flex-1 truncate">{name}</span>
                      {dir && (
                        // Capped (rather than plain shrink-0) so a deeply nested path
                        // truncates itself instead of squeezing the filename above —
                        // the filename staying fully readable is the point of this
                        // redesign, so it must win the remaining space.
                        <span className="max-w-[40%] shrink-0 truncate text-xs text-fg-subtle">
                          {dir}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </>
          )}
        </ul>
      </div>

      {atCapacity && (
        <InfoDialog
          title={t("findFiles")}
          message={tCommon("paneCapacityAlert")}
          confirmLabel={tCommon("actions.confirm")}
          onConfirm={() => setAtCapacity(false)}
        />
      )}
    </div>
  );
}
