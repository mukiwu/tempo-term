import { useTranslation } from "react-i18next";
import {
  FilePlus,
  FileText,
  FolderOpen,
  Globe,
  SquareTerminal,
  Waypoints,
  type LucideIcon,
} from "lucide-react";
import { useTabsStore } from "@/stores/tabsStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useUiStore } from "@/stores/uiStore";
import { useNotesStore } from "@/stores/notesStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { pickNotesFolder } from "@/modules/notes/lib/pickNotesFolder";
import { pickFile, pickFolder } from "@/lib/dialog";
import { IS_MAC } from "@/lib/platform";
import type { PaneContent } from "@/modules/terminal/lib/terminalLayout";

const DEFAULT_PREVIEW_URL = "http://localhost:3000";

const MOD = IS_MAC ? "⌘" : "Ctrl";
const SHIFT = IS_MAC ? "⇧" : "Shift";
const TERMINAL_SHORTCUT = `${MOD} ${SHIFT} T`;

/**
 * Where a chosen launcher option should land.
 * - `newTab`: open it as a new tab; if `closeTabId` is set, close that launcher
 *   tab afterwards so the new tab takes its place.
 * - `replacePane`: fill an existing (freshly split) pane in place.
 */
export type LauncherTarget =
  | { mode: "newTab"; closeTabId?: string }
  | { mode: "replacePane"; tabId: string; leafId: string };

interface LauncherPanelProps {
  target?: LauncherTarget;
}

interface LauncherAction {
  key: string;
  label: string;
  icon: LucideIcon;
  shortcut?: string;
  run: () => void | Promise<void>;
}

interface LauncherGroup {
  key: string;
  label: string;
  actions: LauncherAction[];
}

export function LauncherPanel({ target }: LauncherPanelProps) {
  const { t } = useTranslation();
  const newTerminalTab = useTabsStore((s) => s.newTerminalTab);
  const openEditorTab = useTabsStore((s) => s.openEditorTab);
  const openNoteTab = useTabsStore((s) => s.openNoteTab);
  const openPreviewTab = useTabsStore((s) => s.openPreviewTab);
  const openGitGraphTab = useTabsStore((s) => s.openGitGraphTab);
  const setPaneContent = useTabsStore((s) => s.setPaneContent);
  const closeTab = useTabsStore((s) => s.closeTab);
  const setRoot = useWorkspaceStore((s) => s.setRoot);
  const selectSidebar = useUiStore((s) => s.selectSidebar);
  const createNote = useNotesStore((s) => s.createNote);

  const resolved: LauncherTarget = target ?? { mode: "newTab" };

  // Land the chosen content either by filling the split pane in place, or by
  // opening a new tab (and closing the launcher tab it replaces).
  function apply(content: PaneContent) {
    if (resolved.mode === "replacePane") {
      setPaneContent(resolved.tabId, resolved.leafId, content);
      return;
    }
    switch (content.kind) {
      case "terminal":
        newTerminalTab(useWorkspaceStore.getState().rootPath ?? undefined);
        break;
      case "editor":
        openEditorTab(content.path);
        break;
      case "note":
        openNoteTab(content.noteId, "Untitled");
        break;
      case "preview":
        openPreviewTab(content.url);
        break;
      case "git-graph":
        openGitGraphTab();
        break;
      case "launcher":
        break;
    }
    if (resolved.closeTabId) {
      closeTab(resolved.closeTabId);
    }
  }

  const showShortcuts = resolved.mode === "newTab";

  const groups: LauncherGroup[] = [
    {
      key: "workspace",
      label: t("workspace.launcherGroup.workspace"),
      actions: [
        {
          key: "terminal",
          label: t("workspace.terminal"),
          icon: SquareTerminal,
          shortcut: showShortcuts ? TERMINAL_SHORTCUT : undefined,
          run: () => apply({ kind: "terminal" }),
        },
        {
          key: "folder",
          label: t("workspace.openFolder"),
          icon: FolderOpen,
          run: async () => {
            const folder = await pickFolder();
            if (!folder) {
              return;
            }
            setRoot(folder);
            selectSidebar("explorer");
            apply({ kind: "terminal" });
          },
        },
        {
          key: "file",
          label: t("workspace.openFile"),
          icon: FilePlus,
          run: async () => {
            const file = await pickFile();
            if (!file) {
              return;
            }
            apply({ kind: "editor", path: file });
          },
        },
      ],
    },
    {
      key: "tools",
      label: t("workspace.launcherGroup.tools"),
      actions: [
        {
          key: "note",
          label: t("workspace.note"),
          icon: FileText,
          run: async () => {
            const settings = useSettingsStore.getState();
            let rootPath = settings.notesFolderPath;
            if (!rootPath) {
              const picked = await pickNotesFolder();
              if (!picked) {
                return;
              }
              settings.setNotesFolderPath(picked);
              await useNotesStore.getState().setRoot(picked);
              rootPath = picked;
            }
            const notePath = await createNote(rootPath);
            apply({ kind: "note", noteId: notePath });
          },
        },
        {
          key: "preview",
          label: t("preview:title"),
          icon: Globe,
          run: () => apply({ kind: "preview", url: DEFAULT_PREVIEW_URL }),
        },
        {
          key: "git-graph",
          label: t("nav.gitGraph"),
          icon: Waypoints,
          run: () => apply({ kind: "git-graph" }),
        },
      ],
    },
  ];

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 px-4 bg-bg text-fg-subtle">
      <p className="text-center text-sm">{t("workspace.launcherHint")}</p>
      <div className="flex w-full max-w-72 flex-col gap-5">
        {groups.map((group) => (
          <div key={group.key}>
            <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-fg-subtle">
              {group.label}
            </h3>
            <ul className="divide-y divide-border">
              {group.actions.map(({ key, label, icon: Icon, shortcut, run }) => (
                <li key={key}>
                  <button
                    type="button"
                    onClick={() => void run()}
                    className="flex w-full items-center gap-2.5 rounded-md px-2 py-2.5 text-sm text-fg-muted transition-colors hover:bg-bg-elevated hover:text-fg"
                  >
                    <Icon size={16} className="shrink-0" />
                    <span className="flex-1 text-left">{label}</span>
                    {shortcut && (
                      <kbd className="shrink-0 rounded border border-border-strong bg-bg-inset px-2 py-0.5 font-mono text-xs text-fg">
                        {shortcut}
                      </kbd>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
