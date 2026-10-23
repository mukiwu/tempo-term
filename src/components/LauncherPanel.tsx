import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  FileText,
  FolderOpen,
  Globe,
  Server,
  SquareTerminal,
  Waypoints,
  type LucideIcon,
} from "lucide-react";
import { useTabsStore } from "@/stores/tabsStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { openNewTerminalTab } from "@/modules/terminal/lib/terminalBus";
import { useUiStore } from "@/stores/uiStore";
import { useNotesStore } from "@/stores/notesStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { pickNotesFolder } from "@/modules/notes/lib/pickNotesFolder";
import { pickFolder } from "@/lib/dialog";
import { IS_MAC } from "@/lib/platform";
import type { PaneContent } from "@/modules/terminal/lib/terminalLayout";
import { ConnectionForm } from "@/modules/ssh/ConnectionForm";

const DEFAULT_PREVIEW_URL = "http://localhost:3000";

const MOD = IS_MAC ? "⌘" : "Ctrl";
const TERMINAL_SHORTCUT = `${MOD} T`;

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

export interface LauncherAction {
  key: string;
  label: string;
  icon: LucideIcon;
  shortcut?: string;
  run: () => void | Promise<void>;
}

export interface LauncherGroup {
  key: string;
  label: string;
  actions: LauncherAction[];
}

/**
 * The launcher's actions, grouped, plus the SSH form state one of them opens.
 * Shared by the launcher tab/pane and the tab bar's quick-launch strip so both
 * offer the same options and land them the same way.
 */
export function useLauncherActions(target?: LauncherTarget) {
  const { t } = useTranslation();
  const [sshFormOpen, setSshFormOpen] = useState(false);
  const openEditorTab = useTabsStore((s) => s.openEditorTab);
  const openNoteTab = useTabsStore((s) => s.openNoteTab);
  const openPreviewTab = useTabsStore((s) => s.openPreviewTab);
  const openGitGraphTab = useTabsStore((s) => s.openGitGraphTab);
  const setPaneContent = useTabsStore((s) => s.setPaneContent);
  const closeTab = useTabsStore((s) => s.closeTab);
  const setRoot = useWorkspaceStore((s) => s.setRoot);
  const activatePanel = useUiStore((s) => s.activatePanel);
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
        void openNewTerminalTab();
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
            activatePanel("explorer");
            apply({ kind: "terminal" });
          },
        },
        {
          key: "connect-ssh",
          label: t("workspace.connectSsh"),
          icon: Server,
          run: () => setSshFormOpen(true),
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
            // Reveal the new note in the notes panel, as opening a folder
            // switches to the explorer.
            activatePanel("notes");
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

  return { groups, resolved, sshFormOpen, setSshFormOpen };
}

export function LauncherPanel({ target }: LauncherPanelProps) {
  const { t } = useTranslation();
  const { groups, resolved, sshFormOpen, setSshFormOpen } = useLauncherActions(target);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Whether this launcher is the focused pane. A new-tab launcher is always
  // "active"; a split launcher follows its tab's active leaf, so cycling panes
  // with ⌘` moves keyboard focus into it.
  const isActivePane = useTabsStore((s) => {
    if (resolved.mode !== "replacePane") {
      return true;
    }
    const tab = s.tabs.find((t) => t.id === resolved.tabId);
    return tab?.activeLeafId === resolved.leafId;
  });

  // All actions in display order, so the arrow keys can walk one flat list
  // across both groups. Index into this for the highlighted row.
  const flatActions = groups.flatMap((group) => group.actions);

  // Take focus when this launcher becomes the active pane (a fresh ⌘D / ⌘⇧D
  // split, or cycled into with ⌘`) so the arrow keys drive the list straight
  // away without a click first.
  useEffect(() => {
    if (isActivePane) {
      rootRef.current?.focus();
    }
  }, [isActivePane]);

  // Move the highlight and keep it visible: in a short pane the list scrolls,
  // so an arrow key that lands on an off-screen row has to bring it into view.
  function moveSelection(delta: number) {
    const next = (selectedIndex + delta + flatActions.length) % flatActions.length;
    setSelectedIndex(next);
    itemRefs.current[next]?.scrollIntoView?.({ block: "nearest" });
  }

  function onKeyDown(e: React.KeyboardEvent) {
    // While the SSH form is open it owns the keyboard; let it through.
    if (sshFormOpen || flatActions.length === 0) {
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveSelection(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      moveSelection(-1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      void flatActions[selectedIndex]?.run();
    }
  }

  return (
    <>
      <div
        ref={rootRef}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="h-full overflow-y-auto bg-bg text-fg-subtle outline-none"
      >
        {/* The list centres itself while it fits, and grows past `min-h-full`
            once it does not, so the scroll container above takes over instead
            of letting the overflow paint over the neighbouring panes. */}
        <div className="flex min-h-full flex-col items-center justify-center gap-6 px-4 py-6">
          <p className="text-center text-sm">{t("workspace.launcherHint")}</p>
          <div className="flex w-full max-w-72 shrink-0 flex-col gap-5">
            {groups.map((group) => (
              <div key={group.key}>
                <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-fg-subtle">
                  {group.label}
                </h3>
                <ul className="divide-y divide-border">
                  {group.actions.map(({ key, label, icon: Icon, shortcut, run }) => {
                    const index = flatActions.findIndex((a) => a.key === key);
                    const selected = index === selectedIndex;
                    return (
                      <li key={key}>
                        <button
                          type="button"
                          ref={(el) => {
                            itemRefs.current[index] = el;
                          }}
                          onClick={() => void run()}
                          onMouseEnter={() => setSelectedIndex(index)}
                          aria-selected={selected}
                          className={`flex w-full items-center gap-2.5 rounded-md px-2 py-2.5 text-sm transition-colors ${
                            selected ? "bg-bg-elevated text-fg" : "text-fg-muted"
                          }`}
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
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </div>
      {sshFormOpen && (
        <ConnectionForm onClose={() => setSshFormOpen(false)} />
      )}
    </>
  );
}
