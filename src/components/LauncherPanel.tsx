import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Bot,
  FilePlus,
  FileText,
  FolderOpen,
  Globe,
  Server,
  Sparkles,
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
import { writeToTerminal } from "@/modules/terminal/lib/terminalBus";
import { pickFile, pickFolder } from "@/lib/dialog";
import { IS_MAC } from "@/lib/platform";
import type { PaneContent } from "@/modules/terminal/lib/terminalLayout";
import { ConnectionForm } from "@/modules/ssh/ConnectionForm";
import { buildLauncherCommand } from "./launcherCommand";

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
  const [sshFormOpen, setSshFormOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const newTerminalTab = useTabsStore((s) => s.newTerminalTab);
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

  // Open a terminal and auto-run a CLI command in it (e.g. `claude`, `codex`).
  // The command is queued via writeToTerminal until the freshly spawned shell
  // registers, so it runs once the prompt is ready.
  function openTerminalWithCommand(command: string) {
    // End with CR (`\r`), the byte the Enter key actually sends — PowerShell's
    // PSReadLine binds CR to AcceptLine (submit) but LF to AddLine (a `>>`
    // continuation line that never runs), so an injected LF would leave the
    // command stranded on Windows. CR submits on macOS/Linux too. Strip any
    // trailing CR/LF first so a caller-supplied newline can't yield `\n\r`.
    const line = `${command.replace(/[\r\n]+$/, "")}\r`;
    if (resolved.mode === "replacePane") {
      setPaneContent(resolved.tabId, resolved.leafId, { kind: "terminal" });
      writeToTerminal(resolved.leafId, line);
      return;
    }
    const tabId = newTerminalTab(useWorkspaceStore.getState().rootPath ?? undefined);
    const tab = useTabsStore.getState().tabs.find((t) => t.id === tabId);
    if (tab && tab.kind === "terminal") {
      writeToTerminal(tab.activeLeafId, line);
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
          key: "claude-code",
          label: t("workspace.claudeCode"),
          icon: Sparkles,
          run: () =>
            openTerminalWithCommand(
              buildLauncherCommand("claude", useSettingsStore.getState().claudeFlags),
            ),
        },
        {
          key: "codex",
          label: t("workspace.codex"),
          icon: Bot,
          run: () =>
            openTerminalWithCommand(
              buildLauncherCommand("codex", useSettingsStore.getState().codexFlags),
            ),
        },
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

  function onKeyDown(e: React.KeyboardEvent) {
    // While the SSH form is open it owns the keyboard; let it through.
    if (sshFormOpen || flatActions.length === 0) {
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => (i + 1) % flatActions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => (i - 1 + flatActions.length) % flatActions.length);
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
        className="flex h-full flex-col items-center justify-center gap-6 px-4 bg-bg text-fg-subtle outline-none"
      >
        <p className="text-center text-sm">{t("workspace.launcherHint")}</p>
        <div className="flex w-full max-w-72 flex-col gap-5">
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
      {sshFormOpen && (
        <ConnectionForm onClose={() => setSshFormOpen(false)} />
      )}
    </>
  );
}
