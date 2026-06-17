import { useTranslation } from "react-i18next";
import {
  FilePlus,
  Globe,
  NotebookPen,
  SquareTerminal,
  type LucideIcon,
} from "lucide-react";
import { pickFile } from "@/lib/dialog";
import { useNotesStore } from "@/stores/notesStore";
import { useTabsStore } from "@/stores/tabsStore";
import { Tooltip } from "@/components/Tooltip";
import type { PaneContent } from "./lib/terminalLayout";

const DEFAULT_PREVIEW_URL = "http://localhost:3000";

interface PaneType {
  key: string;
  icon: LucideIcon;
  /** Build the pane content, or null to cancel (e.g. the file dialog closed). */
  make: () => Promise<PaneContent | null>;
}

const PANE_TYPES: PaneType[] = [
  { key: "terminal", icon: SquareTerminal, make: async () => ({ kind: "terminal" }) },
  {
    key: "editor",
    icon: FilePlus,
    make: async () => {
      const file = await pickFile();
      return file ? { kind: "editor", path: file } : null;
    },
  },
  {
    key: "note",
    icon: NotebookPen,
    make: async () => ({ kind: "note", noteId: useNotesStore.getState().createNote() }),
  },
  {
    key: "preview",
    icon: Globe,
    make: async () => ({ kind: "preview", url: DEFAULT_PREVIEW_URL }),
  },
];

interface PaneToolbarProps {
  tabId: string;
  leafId: string;
}

/**
 * The split toolbar: one icon per content type. A click splits the active pane
 * to the right; Alt(Option)+click splits down. Tooltips spell out the gesture.
 */
export function PaneToolbar({ tabId, leafId }: PaneToolbarProps) {
  const { t } = useTranslation();
  const splitPaneWith = useTabsStore((s) => s.splitPaneWith);

  async function select(type: PaneType, altKey: boolean) {
    const content = await type.make();
    if (content) {
      splitPaneWith(tabId, leafId, content, altKey ? "col" : "row");
    }
  }

  return (
    <div className="flex items-center gap-0.5">
      {PANE_TYPES.map((type) => {
        const Icon = type.icon;
        return (
          <Tooltip
            key={type.key}
            side="bottom"
            label={t("workspace.splitHint", { label: t(`workspace.pane.${type.key}`) })}
          >
            <button
              type="button"
              aria-label={t(`workspace.pane.${type.key}`)}
              onClick={(e) => void select(type, e.altKey)}
              className="rounded p-1 text-fg-muted hover:bg-bg-elevated hover:text-fg"
            >
              <Icon size={14} />
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}
