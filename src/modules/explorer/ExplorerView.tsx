import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Search } from "lucide-react";
import { FileTree } from "./FileTree";
import { FileFinder } from "./FileFinder";
import { fsHomeDir, fsReadDir, type DirEntry } from "./lib/fsBridge";
import { useWorkspaceStore } from "@/stores/workspaceStore";

export function ExplorerView() {
  const { t } = useTranslation("explorer");
  const rootPath = useWorkspaceStore((s) => s.rootPath);
  const setRoot = useWorkspaceStore((s) => s.setRoot);
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [finderOpen, setFinderOpen] = useState(false);

  // Default the workspace root to the home directory the first time we show.
  useEffect(() => {
    if (!rootPath) {
      fsHomeDir()
        .then(setRoot)
        .catch(() => {});
    }
  }, [rootPath, setRoot]);

  useEffect(() => {
    if (!rootPath) {
      return;
    }
    setLoading(true);
    fsReadDir(rootPath)
      .then(setEntries)
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  }, [rootPath]);

  return (
    <div className="relative flex h-full flex-col bg-[--color-bg-inset]">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-[--color-border] px-3">
        <span className="truncate text-xs font-semibold uppercase tracking-wide text-[--color-fg-subtle]">
          {t("title")}
        </span>
        <button
          type="button"
          aria-label={t("findFiles")}
          title={t("findFiles")}
          onClick={() => setFinderOpen(true)}
          className="rounded p-1 text-[--color-fg-muted] hover:bg-[--color-bg-elevated] hover:text-[--color-fg]"
        >
          <Search size={15} />
        </button>
      </div>

      {rootPath && (
        <div
          className="truncate border-b border-[--color-border] px-3 py-1 text-[11px] text-[--color-fg-subtle]"
          title={rootPath}
        >
          {rootPath}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {loading ? (
          <p className="px-3 py-2 text-xs text-[--color-fg-subtle]">{t("loading")}</p>
        ) : entries.length === 0 ? (
          <p className="px-3 py-2 text-xs text-[--color-fg-subtle]">{t("empty")}</p>
        ) : (
          <FileTree entries={entries} />
        )}
      </div>

      {finderOpen && rootPath && (
        <FileFinder root={rootPath} onClose={() => setFinderOpen(false)} />
      )}
    </div>
  );
}
