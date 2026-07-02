import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CopyMinus, FolderOpen, Search } from "lucide-react";
import { FileTree } from "./FileTree";
import { FileFinder } from "./FileFinder";
import { Tooltip } from "@/components/Tooltip";
import { fsReadDir, type DirEntry } from "./lib/fsBridge";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useUiStore } from "@/stores/uiStore";
import { pickFolder } from "@/lib/dialog";
import { isRemoteUri, parseRemoteUri } from "@/modules/ssh/lib/remotePath";

export function ExplorerView() {
  const { t } = useTranslation("explorer");
  const rootPath = useWorkspaceStore((s) => s.rootPath);
  const setRoot = useWorkspaceStore((s) => s.setRoot);
  const finderOpen = useUiStore((s) => s.fileFinderOpen);
  const setFinderOpen = useUiStore((s) => s.setFileFinderOpen);
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [collapseSignal, setCollapseSignal] = useState(0);

  // A remote (SFTP) root hides local-only controls and shows the remote path
  // rather than the raw ssh:// uri.
  const remote = rootPath ? isRemoteUri(rootPath) : false;
  const displayRoot = rootPath ? (parseRemoteUri(rootPath)?.path ?? rootPath) : null;

  async function openFolder() {
    const folder = await pickFolder();
    if (folder) {
      setRoot(folder);
    }
  }

  // Reload the root listing; also used after a top-level create/delete so the
  // tree stays in sync without reopening the folder.
  const loadEntries = useCallback(() => {
    if (!rootPath) {
      setEntries([]);
      return;
    }
    setLoading(true);
    fsReadDir(rootPath)
      .then(setEntries)
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  }, [rootPath]);

  // The root follows the active workspace tab; no folder open means empty.
  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  return (
    <div className="relative flex h-full flex-col bg-bg-inset">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-border px-3">
        <span className="truncate text-xs font-semibold uppercase tracking-wide text-fg-subtle">
          {t("title")}
        </span>
        <div className="flex items-center gap-0.5">
          {!remote && (
            <>
              <Tooltip label={t("openFolder")}>
                <button
                  type="button"
                  aria-label={t("openFolder")}
                  onClick={() => void openFolder()}
                  className="rounded p-1 text-fg-muted hover:bg-bg-elevated hover:text-fg"
                >
                  <FolderOpen size={15} />
                </button>
              </Tooltip>
              <Tooltip label={t("findFiles")}>
                <button
                  type="button"
                  aria-label={t("findFiles")}
                  onClick={() => setFinderOpen(true)}
                  className="rounded p-1 text-fg-muted hover:bg-bg-elevated hover:text-fg"
                >
                  <Search size={15} />
                </button>
              </Tooltip>
            </>
          )}
          {rootPath && (
            <Tooltip label={t("collapseAll")}>
              <button
                type="button"
                aria-label={t("collapseAll")}
                onClick={() => setCollapseSignal((v) => v + 1)}
                className="rounded p-1 text-fg-muted hover:bg-bg-elevated hover:text-fg"
              >
                <CopyMinus size={15} />
              </button>
            </Tooltip>
          )}
        </div>
      </div>

      {rootPath && (
        <div className="border-b border-border px-3 py-1">
          <Tooltip label={displayRoot ?? rootPath} className="max-w-full">
            <span className="block truncate text-[11px] text-fg-subtle">{displayRoot}</span>
          </Tooltip>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {loading ? (
          <p className="px-3 py-2 text-xs text-fg-subtle">{t("loading")}</p>
        ) : entries.length === 0 ? (
          <p className="px-3 py-2 text-xs text-fg-subtle">{t("empty")}</p>
        ) : (
          <FileTree entries={entries} onReloadRoot={loadEntries} collapseSignal={collapseSignal} />
        )}
      </div>

      {finderOpen && rootPath && !remote && (
        <FileFinder root={rootPath} onClose={() => setFinderOpen(false)} />
      )}
    </div>
  );
}
