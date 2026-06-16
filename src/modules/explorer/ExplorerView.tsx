import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { FolderOpen, Search } from "lucide-react";
import { FileTree } from "./FileTree";
import { FileFinder } from "./FileFinder";
import { fsReadDir, type DirEntry } from "./lib/fsBridge";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useUiStore } from "@/stores/uiStore";
import { pickFolder } from "@/lib/dialog";

export function ExplorerView() {
  const { t } = useTranslation("explorer");
  const rootPath = useWorkspaceStore((s) => s.rootPath);
  const setRoot = useWorkspaceStore((s) => s.setRoot);
  const finderOpen = useUiStore((s) => s.fileFinderOpen);
  const setFinderOpen = useUiStore((s) => s.setFileFinderOpen);
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [loading, setLoading] = useState(false);

  async function openFolder() {
    const folder = await pickFolder();
    if (folder) {
      setRoot(folder);
    }
  }

  // The root follows the active workspace tab; no folder open means empty.
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
    <div className="relative flex h-full flex-col bg-bg-inset">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-border px-3">
        <span className="truncate text-xs font-semibold uppercase tracking-wide text-fg-subtle">
          {t("title")}
        </span>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            aria-label={t("openFolder")}
            title={t("openFolder")}
            onClick={() => void openFolder()}
            className="rounded p-1 text-fg-muted hover:bg-bg-elevated hover:text-fg"
          >
            <FolderOpen size={15} />
          </button>
          <button
            type="button"
            aria-label={t("findFiles")}
            title={t("findFiles")}
            onClick={() => setFinderOpen(true)}
            className="rounded p-1 text-fg-muted hover:bg-bg-elevated hover:text-fg"
          >
            <Search size={15} />
          </button>
        </div>
      </div>

      {rootPath && (
        <div
          className="truncate border-b border-border px-3 py-1 text-[11px] text-fg-subtle"
          title={rootPath}
        >
          {rootPath}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {loading ? (
          <p className="px-3 py-2 text-xs text-fg-subtle">{t("loading")}</p>
        ) : entries.length === 0 ? (
          <p className="px-3 py-2 text-xs text-fg-subtle">{t("empty")}</p>
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
