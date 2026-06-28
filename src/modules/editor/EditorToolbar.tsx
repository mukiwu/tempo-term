import { useTranslation } from "react-i18next";
import {
  Columns2,
  Eye,
  Globe,
  RefreshCw,
  SquarePen,
  WrapText,
  type LucideIcon,
} from "lucide-react";
import { Tooltip } from "@/components/Tooltip";
import { basename } from "@/modules/explorer/lib/paths";
import { isHtmlPath, isMarkdownPath } from "./lib/language";

export type EditorMode = "edit" | "split" | "preview";

const MODES: { key: EditorMode; icon: LucideIcon }[] = [
  { key: "edit", icon: SquarePen },
  { key: "split", icon: Columns2 },
  { key: "preview", icon: Eye },
];

interface EditorToolbarProps {
  path: string;
  wordWrap: boolean;
  onToggleWordWrap: () => void;
  onRefresh: () => void;
  onOpenWebPreview?: () => void;
  mode: EditorMode;
  onSetMode: (mode: EditorMode) => void;
}

/** Toolbar row shown at the top of every editor pane. Fully presentational. */
export function EditorToolbar({
  path,
  wordWrap,
  onToggleWordWrap,
  onRefresh,
  onOpenWebPreview,
  mode,
  onSetMode,
}: EditorToolbarProps) {
  const { t } = useTranslation("editor");
  const isMarkdown = isMarkdownPath(path);
  const isHtml = isHtmlPath(path);

  return (
    /* pr-8 leaves room for the pane's close button (absolute, top-right). */
    <div className="flex h-7 shrink-0 items-center justify-between gap-2 border-b border-border pl-2 pr-8">
      <span className="min-w-0 truncate text-xs text-fg-muted" title={path}>
        {basename(path)}
      </span>
      <div className="flex shrink-0 items-center gap-0.5">
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
      </div>
    </div>
  );
}
