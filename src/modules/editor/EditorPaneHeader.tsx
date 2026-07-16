import { useTranslation } from "react-i18next";
import {
  Columns2,
  Eye,
  FileText,
  Globe,
  RefreshCw,
  SquarePen,
  WrapText,
  type LucideIcon,
} from "lucide-react";
import { PaneHeader } from "@/components/PaneHeader";
import { Breadcrumb } from "@/components/Breadcrumb";
import { Tooltip } from "@/components/Tooltip";
import { buildCrumbs } from "@/lib/breadcrumb";
import { listSiblingFiles, useHomeDir } from "@/components/paneCrumbs";
import { buildRemoteUri, parseRemoteUri } from "@/modules/ssh/lib/remotePath";
import { isHtmlPath, isMarkdownPath } from "./lib/language";

export type EditorMode = "edit" | "split" | "preview";

const MODES: { key: EditorMode; icon: LucideIcon }[] = [
  { key: "edit", icon: SquarePen },
  { key: "split", icon: Columns2 },
  { key: "preview", icon: Eye },
];

interface EditorPaneHeaderProps {
  path: string;
  wordWrap: boolean;
  onToggleWordWrap: () => void;
  onRefresh: () => void;
  onOpenWebPreview?: () => void;
  mode: EditorMode;
  onSetMode: (mode: EditorMode) => void;
  /** Switch this pane to another file (breadcrumb pick) — never a new tab. */
  onSwitchFile: (path: string) => void;
  showClose: boolean;
  onClose: () => void;
}

/**
 * The toolbar row at the top of every editor pane, built on the shared
 * PaneHeader. The breadcrumb's filename segment lists the files sharing the
 * folder; picking one swaps the file this pane shows (docs/adr 0001).
 * Directory segments are display-only — an editor has nothing to do with a
 * directory.
 */
export function EditorPaneHeader({
  path,
  wordWrap,
  onToggleWordWrap,
  onRefresh,
  onOpenWebPreview,
  mode,
  onSetMode,
  onSwitchFile,
  showClose,
  onClose,
}: EditorPaneHeaderProps) {
  const { t } = useTranslation("editor");
  const isMarkdown = isMarkdownPath(path);
  const isHtml = isHtmlPath(path);

  // A remote file's crumbs come from its plain remote path, relative to the
  // remote home.
  const remote = parseRemoteUri(path);
  const homeDir = useHomeDir(remote?.connectionId);
  const crumbs = buildCrumbs(remote?.path ?? path, { homeDir });

  return (
    <PaneHeader
      left={
        crumbs.length > 0 ? (
          <Tooltip label={path} className="min-w-0">
            <Breadcrumb
              crumbs={crumbs}
              clickable="last"
              menu={{
                kind: "list",
                loadItems: (crumb) => listSiblingFiles(crumb.path, remote?.connectionId),
                icon: FileText,
              }}
              onSelect={(picked) =>
                onSwitchFile(remote ? buildRemoteUri(remote.connectionId, picked) : picked)
              }
            />
          </Tooltip>
        ) : undefined
      }
      actions={
        <>
          <Tooltip label={t("refresh")}>
            <button
              type="button"
              aria-label={t("refresh")}
              onClick={onRefresh}
              className="rounded p-1 text-fg-muted hover:bg-bg-elevated hover:text-fg"
            >
              <RefreshCw size={14} />
            </button>
          </Tooltip>
          <Tooltip label={t("wrap")}>
            <button
              type="button"
              aria-label={t("wrap")}
              aria-pressed={wordWrap}
              onClick={onToggleWordWrap}
              className={`rounded p-1 ${
                wordWrap
                  ? "bg-bg-elevated text-fg"
                  : "text-fg-muted hover:bg-bg-elevated hover:text-fg"
              }`}
            >
              <WrapText size={14} />
            </button>
          </Tooltip>
          {isHtml && onOpenWebPreview && (
            <Tooltip label={t("webPreview")}>
              <button
                type="button"
                aria-label={t("webPreview")}
                onClick={onOpenWebPreview}
                className="rounded p-1 text-fg-muted hover:bg-bg-elevated hover:text-fg"
              >
                <Globe size={14} />
              </button>
            </Tooltip>
          )}
          {isMarkdown &&
            MODES.map((m) => {
              const Icon = m.icon;
              const active = mode === m.key;
              return (
                <Tooltip key={m.key} label={t(`mode.${m.key}`)}>
                  <button
                    type="button"
                    aria-label={t(`mode.${m.key}`)}
                    aria-pressed={active}
                    onClick={() => onSetMode(m.key)}
                    className={`rounded p-1 ${
                      active
                        ? "bg-bg-elevated text-fg"
                        : "text-fg-muted hover:bg-bg-elevated hover:text-fg"
                    }`}
                  >
                    <Icon size={14} />
                  </button>
                </Tooltip>
              );
            })}
        </>
      }
      showClose={showClose}
      onClose={onClose}
    />
  );
}
