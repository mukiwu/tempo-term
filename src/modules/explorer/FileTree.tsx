import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  ChevronRight,
  Clipboard,
  ClipboardList,
  File,
  FilePlus,
  FolderOpen,
  FolderPlus,
  MessageSquarePlus,
  Pencil,
  SquarePlus,
  TerminalSquare,
  Trash2,
} from "lucide-react";
import { FileIcon } from "./components/FileIcon";
import {
  fsCreateDir,
  fsCreateFile,
  fsDelete,
  fsReadDir,
  fsRename,
  fsReveal,
  type DirEntry,
} from "./lib/fsBridge";
import { dirname, joinPath, relativePath } from "./lib/paths";
import { beginEntryDrag, consumeDragClick } from "./lib/dragEntry";
import { isRemoteUri } from "@/modules/ssh/lib/remotePath";
import { ContextMenu, type ContextMenuItem } from "@/components/ContextMenu";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { InfoDialog } from "@/components/InfoDialog";
import { Tooltip } from "@/components/Tooltip";
import { useTabsStore } from "@/stores/tabsStore";
import { computeLayout } from "@/modules/terminal/lib/terminalLayout";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useUiStore } from "@/stores/uiStore";
import { useChatStore } from "@/modules/ai/store/chatStore";

type MenuPosition = { x: number; y: number };

/**
 * Directory names Expand All should not auto-descend into. `fs_read_dir`
 * (unlike the search palette's gitignore-aware `fs_list_files`) has no
 * ignore-file awareness, so an unconditional recursive cascade would mount a
 * child TreeNode for every file inside e.g. `node_modules` — tens of
 * thousands of DOM nodes for a typical JS project — which then makes the
 * next collapse-all pass (a single synchronous unmount of all of them)
 * visibly slow. Matches the common set of generated/dependency directories
 * most editors also skip during a bulk "expand all". A manual click on one
 * of these still opens it — only the automatic cascade skips it.
 */
const AUTO_EXPAND_EXCLUDED_DIRS = new Set([
  "node_modules",
  ".git",
  "target",
  "dist",
  "build",
  ".next",
  ".turbo",
  ".venv",
  "venv",
  "__pycache__",
]);

/** Whether an inline name input is open, and which kind of entry it creates. */
type Creating = { kind: "file" | "dir" } | null;

interface TreeNodeProps {
  entry: DirEntry;
  depth: number;
  /** Ask the parent node to reload its children (after a create/delete here). */
  onReloadParent: () => void;
  /** Increments when the header's collapse-all button fires; folds this node. */
  collapseSignal?: number;
  /** Increments when the header's expand-all button fires; unfolds this node. */
  expandSignal?: number;
}

function TreeNode({ entry, depth, onReloadParent, collapseSignal, expandSignal }: TreeNodeProps) {
  const { t } = useTranslation("explorer");
  const { t: tCommon } = useTranslation("common");
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<DirEntry[] | null>(null);
  const [menu, setMenu] = useState<MenuPosition | null>(null);
  const [creating, setCreating] = useState<Creating>(null);
  const [renaming, setRenaming] = useState(false);
  const [atCapacity, setAtCapacity] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // JS hover: CSS :hover is suppressed inside a draggable subtree (WebKit), so
  // track hover manually to highlight just this row.
  const [hovered, setHovered] = useState(false);
  // Whether this node is currently expanded *because* of an expand-all
  // cascade (as opposed to a manual click). expandSignal itself never
  // resets, so this is what lets a later manual re-expand stay local
  // instead of re-cascading into this node's children.
  const [isExpandingAll, setIsExpandingAll] = useState(false);
  // Bumped every time this node is told to collapse (collapse-all or a
  // manual toggle-close). expand() is async (it may await a real fsReadDir
  // IPC round trip), so a fetch kicked off just before a collapse can land
  // after it; expand() checks this token to tell whether that happened and,
  // if so, drops its own result instead of silently re-opening the folder
  // the user just asked to close. This matters most right after Expand All,
  // which can leave many such fetches in flight at once.
  const collapseTokenRef = useRef(0);

  // Skip the initial value (0 / undefined) so a future restore-on-mount of
  // expanded state wouldn't be immediately collapsed.
  useEffect(() => {
    if (collapseSignal) {
      collapseTokenRef.current += 1;
      setExpanded(false);
      setIsExpandingAll(false);
    }
  }, [collapseSignal]);

  // Mirrors the collapse-all effect above. Runs on mount too, which is what
  // makes it cascade into lazily-loaded children: expanding a node here
  // mounts its child TreeNodes with the same (already-nonzero) expandSignal,
  // so each of them expands itself in turn as soon as it appears. (expand()
  // itself is a no-op for files, so no is_dir check is needed here.) Only
  // this effect ever sets isExpandingAll true; it's reset explicitly at
  // every place a collapse happens (above, and in toggle() below) rather
  // than via an effect on `expanded` itself, since that would also fire
  // (and immediately undo this) on every fresh mount, where `expanded`
  // starts out false by default.
  useEffect(() => {
    if (expandSignal && !(entry.is_dir && AUTO_EXPAND_EXCLUDED_DIRS.has(entry.name))) {
      setIsExpandingAll(true);
      void expand();
    }
  }, [expandSignal]);

  const openFromSidebar = useTabsStore((s) => s.openFromSidebar);
  const openInNewTab = useTabsStore((s) => s.openInNewTab);
  const rootPath = useWorkspaceStore((s) => s.rootPath);
  const activatePanel = useUiStore((s) => s.activatePanel);
  const attachPath = useChatStore((s) => s.attachPath);
  const activeEditorPath = useTabsStore((s) => {
    const active = s.tabs.find((tab) => tab.id === s.activeId);
    if (!active) {
      return null;
    }
    const pane = computeLayout(active.paneTree).find((p) => p.id === active.activeLeafId);
    return pane && pane.content.kind === "editor" ? pane.content.path : null;
  });
  const isActive = !entry.is_dir && activeEditorPath === entry.path;

  // Reloads this directory's children from disk; used after create/delete so
  // the tree reflects the change without collapsing.
  const reloadChildren = useCallback(async () => {
    try {
      setChildren(await fsReadDir(entry.path));
    } catch {
      setChildren([]);
    }
  }, [entry.path]);

  async function expand() {
    if (!entry.is_dir) {
      return;
    }
    const token = collapseTokenRef.current;
    if (children === null) {
      await reloadChildren();
    }
    if (collapseTokenRef.current !== token) {
      // Collapsed (collapse-all or a manual toggle) while this fetch was in
      // flight; respect that instead of re-opening behind the user's back.
      return;
    }
    setExpanded(true);
  }

  async function toggle() {
    if (!entry.is_dir) {
      const result = openFromSidebar({ kind: "editor", path: entry.path });
      if (result.status === "at-capacity") {
        setAtCapacity(true);
      }
      return;
    }
    if (expanded) {
      collapseTokenRef.current += 1;
      setExpanded(false);
      setIsExpandingAll(false);
      return;
    }
    await expand();
  }

  // The directory new entries land in: this folder itself, or this file's parent.
  const targetDir = entry.is_dir ? entry.path : dirname(entry.path);

  function startCreate(kind: "file" | "dir") {
    setCreating({ kind });
    if (entry.is_dir) {
      void expand();
    }
  }

  async function confirmCreate(name: string) {
    const trimmed = name.trim();
    setCreating(null);
    if (!trimmed || !creating) {
      return;
    }
    const path = joinPath(targetDir, trimmed);
    try {
      if (creating.kind === "file") {
        await fsCreateFile(path);
      } else {
        await fsCreateDir(path);
      }
    } catch {
      return;
    }
    // Refresh whichever node owns the target directory, then open new files.
    if (entry.is_dir) {
      await reloadChildren();
    } else {
      onReloadParent();
    }
    if (creating.kind === "file") {
      const result = openFromSidebar({ kind: "editor", path });
      if (result.status === "at-capacity") {
        setAtCapacity(true);
      }
    }
  }

  async function handleDelete() {
    try {
      await fsDelete(entry.path, entry.is_dir);
    } catch {
      return;
    }
    onReloadParent();
  }

  async function confirmRename(name: string) {
    const trimmed = name.trim();
    setRenaming(false);
    if (!trimmed || trimmed === entry.name) {
      return;
    }
    const to = joinPath(dirname(entry.path), trimmed);
    try {
      await fsRename(entry.path, to);
    } catch {
      return;
    }
    onReloadParent();
  }

  function copyToClipboard(text: string) {
    void navigator.clipboard.writeText(text);
  }

  function attachToAgent() {
    attachPath(entry.path);
    activatePanel("ai");
  }

  const menuItems: ContextMenuItem[] = [
    {
      id: "open",
      label: t("menu.open"),
      icon: entry.is_dir ? FolderOpen : File,
      group: 0,
      onSelect: () => void toggle(),
    },
    ...(!entry.is_dir
      ? [
          {
            id: "openInNewTab",
            label: t("menu.openInNewTab"),
            icon: SquarePlus,
            group: 0,
            onSelect: () => openInNewTab({ kind: "editor", path: entry.path }),
          } satisfies ContextMenuItem,
        ]
      : []),
    {
      id: "reveal",
      label: t("menu.reveal"),
      icon: FolderOpen,
      group: 0,
      onSelect: () => void fsReveal(entry.path),
    },
    ...(entry.is_dir
      ? [
          {
            id: "openInTerminal",
            label: t("menu.openInTerminal"),
            icon: TerminalSquare,
            group: 0,
            // Just open the new pane in that dir; the new pane's cwd-tracking
            // drives the explorer. Don't setRoot here — it would cd the old pane.
            onSelect: () => {
              useTabsStore.getState().newTerminalTab(entry.path);
            },
          } satisfies ContextMenuItem,
        ]
      : []),
    {
      id: "newFile",
      label: t("menu.newFile"),
      icon: FilePlus,
      group: 1,
      onSelect: () => startCreate("file"),
    },
    {
      id: "newFolder",
      label: t("menu.newFolder"),
      icon: FolderPlus,
      group: 1,
      onSelect: () => startCreate("dir"),
    },
    {
      id: "copyPath",
      label: t("menu.copyPath"),
      icon: Clipboard,
      group: 2,
      onSelect: () => copyToClipboard(entry.path),
    },
    {
      id: "copyRelativePath",
      label: t("menu.copyRelativePath"),
      icon: ClipboardList,
      group: 2,
      onSelect: () =>
        copyToClipboard(rootPath ? relativePath(entry.path, rootPath) : entry.path),
    },
    {
      id: "attach",
      label: t("menu.attachToAgent"),
      icon: MessageSquarePlus,
      group: 3,
      onSelect: attachToAgent,
    },
    {
      id: "rename",
      label: t("menu.rename"),
      icon: Pencil,
      group: 4,
      onSelect: () => setRenaming(true),
    },
    {
      id: "delete",
      label: t("menu.delete"),
      icon: Trash2,
      group: 4,
      danger: true,
      // Local deletes go to the OS trash and are recoverable, so they fire
      // immediately as before. Remote (SFTP) deletes are permanent, so gate
      // them behind a confirm dialog first.
      onSelect: () => {
        if (isRemoteUri(entry.path)) {
          setConfirmingDelete(true);
        } else {
          void handleDelete();
        }
      },
    },
  ];

  return (
    <li>
      {/* Pointer-based drag (not HTML5) so Tauri's native drag interception
          doesn't break hover/drop coordinates; the row swallows the click that
          trails a completed drag so it doesn't also open/expand the entry. */}
      {!renaming && (
        <div
          onPointerDown={(event) =>
            beginEntryDrag(
              { path: entry.path, name: entry.name, isDir: entry.is_dir },
              event,
            )
          }
        >
          <Tooltip label={entry.name} className="w-full">
            <button
              type="button"
              onClick={() => {
                if (consumeDragClick()) {
                  return;
                }
                void toggle();
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                setMenu({ x: event.clientX, y: event.clientY });
              }}
              onMouseEnter={() => setHovered(true)}
              onMouseLeave={() => setHovered(false)}
              style={{ paddingLeft: depth * 12 + 8 }}
              className={`flex w-full items-center gap-1.5 py-1 pr-2 text-left text-[13px] transition-colors ${
                isActive
                  ? "bg-accent/15 text-fg"
                  : hovered
                    ? "bg-fg/10 text-fg"
                    : "text-fg-muted"
              }`}
            >
              {entry.is_dir ? (
                <>
                  {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  <FileIcon name={entry.name} isDir open={expanded} size={16} />
                </>
              ) : (
                <>
                  <span className="w-[14px]" />
                  <FileIcon name={entry.name} isDir={false} size={16} />
                </>
              )}
              <span className="truncate">{entry.name}</span>
            </button>
          </Tooltip>
        </div>
      )}

      {creating && (
        <NewEntryInput
          kind={creating.kind}
          depth={depth + 1}
          onConfirm={confirmCreate}
          onCancel={() => setCreating(null)}
        />
      )}

      {renaming && (
        <NewEntryInput
          kind={entry.is_dir ? "dir" : "file"}
          depth={depth}
          initialValue={entry.name}
          onConfirm={(name) => void confirmRename(name)}
          onCancel={() => setRenaming(false)}
        />
      )}

      {entry.is_dir && expanded && children && children.length > 0 && (
        <ul>
          {children.map((child) => (
            <TreeNode
              key={child.path}
              entry={child}
              depth={depth + 1}
              onReloadParent={reloadChildren}
              collapseSignal={collapseSignal}
              expandSignal={isExpandingAll ? expandSignal : undefined}
            />
          ))}
        </ul>
      )}

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems}
          onClose={() => setMenu(null)}
        />
      )}

      {atCapacity && (
        <InfoDialog
          title={t("menu.open")}
          message={tCommon("paneCapacityAlert")}
          confirmLabel={tCommon("actions.confirm")}
          onConfirm={() => setAtCapacity(false)}
        />
      )}

      {confirmingDelete && (
        <ConfirmDialog
          title={t("menu.delete")}
          message={t("menu.deleteRemoteConfirm", { name: entry.name })}
          confirmLabel={t("menu.delete")}
          cancelLabel={tCommon("actions.cancel")}
          onConfirm={() => {
            setConfirmingDelete(false);
            void handleDelete();
          }}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}
    </li>
  );
}

interface NewEntryInputProps {
  kind: "file" | "dir";
  depth: number;
  /** Pre-filled text (rename); empty for a new entry. */
  initialValue?: string;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}

/** An inline row that prompts for a new file or folder name, in place in the tree. */
function NewEntryInput({ kind, depth, initialValue, onConfirm, onCancel }: NewEntryInputProps) {
  const { t } = useTranslation("explorer");
  const [value, setValue] = useState(initialValue ?? "");

  return (
    <div
      style={{ paddingLeft: depth * 12 + 8 }}
      className="flex items-center gap-1.5 py-1 pr-2"
    >
      <span className="w-[14px]" />
      <FileIcon
        name={value || (kind === "dir" ? "folder" : "file")}
        isDir={kind === "dir"}
        size={16}
      />
      <input
        autoFocus
        value={value}
        placeholder={kind === "file" ? t("menu.newFilePlaceholder") : t("menu.newFolderPlaceholder")}
        aria-label={kind === "file" ? t("menu.newFile") : t("menu.newFolder")}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          // Ignore the Enter that commits an IME candidate (CJK input), so it
          // doesn't also confirm/cancel this entry mid-composition.
          if (event.nativeEvent.isComposing || event.keyCode === 229) {
            return;
          }
          if (event.key === "Enter") {
            event.preventDefault();
            onConfirm(value);
          } else if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
        onBlur={() => onConfirm(value)}
        className="min-w-0 flex-1 rounded border border-accent bg-bg px-1.5 py-0.5 text-sm text-fg outline-none"
      />
    </div>
  );
}

interface FileTreeProps {
  entries: DirEntry[];
  onReloadRoot: () => void;
  /** Increments when the header's collapse-all button fires; folds every folder. */
  collapseSignal?: number;
  /** Increments when the header's expand-all button fires; unfolds every folder. */
  expandSignal?: number;
}

export function FileTree({ entries, onReloadRoot, collapseSignal, expandSignal }: FileTreeProps) {
  return (
    <ul className="select-none">
      {entries.map((entry) => (
        <TreeNode
          key={entry.path}
          entry={entry}
          depth={0}
          onReloadParent={onReloadRoot}
          collapseSignal={collapseSignal}
          expandSignal={expandSignal}
        />
      ))}
    </ul>
  );
}
