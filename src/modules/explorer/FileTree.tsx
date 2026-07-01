import { useCallback, useState } from "react";
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
  TerminalSquare,
  Trash2,
} from "lucide-react";
import { FileIcon } from "./components/FileIcon";
import {
  fsCreateDir,
  fsCreateFile,
  fsDelete,
  fsReadDir,
  fsReveal,
  type DirEntry,
} from "./lib/fsBridge";
import { dirname, joinPath, relativePath } from "./lib/paths";
import { beginEntryDrag, consumeDragClick } from "./lib/dragEntry";
import { ContextMenu, type ContextMenuItem } from "@/components/ContextMenu";
import { useTabsStore } from "@/stores/tabsStore";
import { computeLayout } from "@/modules/terminal/lib/terminalLayout";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useUiStore } from "@/stores/uiStore";
import { useChatStore } from "@/modules/ai/store/chatStore";

type MenuPosition = { x: number; y: number };

/** Whether an inline name input is open, and which kind of entry it creates. */
type Creating = { kind: "file" | "dir" } | null;

interface TreeNodeProps {
  entry: DirEntry;
  depth: number;
  /** Ask the parent node to reload its children (after a create/delete here). */
  onReloadParent: () => void;
}

function TreeNode({ entry, depth, onReloadParent }: TreeNodeProps) {
  const { t } = useTranslation("explorer");
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<DirEntry[] | null>(null);
  const [menu, setMenu] = useState<MenuPosition | null>(null);
  const [creating, setCreating] = useState<Creating>(null);
  // JS hover: CSS :hover is suppressed inside a draggable subtree (WebKit), so
  // track hover manually to highlight just this row.
  const [hovered, setHovered] = useState(false);

  const openFromSidebar = useTabsStore((s) => s.openFromSidebar);
  const rootPath = useWorkspaceStore((s) => s.rootPath);
  const selectSidebar = useUiStore((s) => s.selectSidebar);
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
    if (children === null) {
      await reloadChildren();
    }
    setExpanded(true);
  }

  async function toggle() {
    if (!entry.is_dir) {
      openFromSidebar({ kind: "editor", path: entry.path });
      return;
    }
    if (expanded) {
      setExpanded(false);
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
      openFromSidebar({ kind: "editor", path });
    }
  }

  async function handleDelete() {
    try {
      await fsDelete(entry.path);
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
    selectSidebar("ai");
  }

  const menuItems: ContextMenuItem[] = [
    {
      id: "open",
      label: t("menu.open"),
      icon: entry.is_dir ? FolderOpen : File,
      group: 0,
      onSelect: () => void toggle(),
    },
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
      id: "delete",
      label: t("menu.delete"),
      icon: Trash2,
      group: 4,
      danger: true,
      onSelect: () => void handleDelete(),
    },
  ];

  return (
    <li>
      {/* Pointer-based drag (not HTML5) so Tauri's native drag interception
          doesn't break hover/drop coordinates; the row swallows the click that
          trails a completed drag so it doesn't also open/expand the entry. */}
      <div
        onPointerDown={(event) =>
          beginEntryDrag(
            { path: entry.path, name: entry.name, isDir: entry.is_dir },
            event,
          )
        }
      >
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
          title={entry.name}
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
      </div>

      {creating && (
        <NewEntryInput
          kind={creating.kind}
          depth={depth + 1}
          onConfirm={confirmCreate}
          onCancel={() => setCreating(null)}
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
    </li>
  );
}

interface NewEntryInputProps {
  kind: "file" | "dir";
  depth: number;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}

/** An inline row that prompts for a new file or folder name, in place in the tree. */
function NewEntryInput({ kind, depth, onConfirm, onCancel }: NewEntryInputProps) {
  const { t } = useTranslation("explorer");
  const [value, setValue] = useState("");

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
}

export function FileTree({ entries, onReloadRoot }: FileTreeProps) {
  return (
    <ul className="select-none">
      {entries.map((entry) => (
        <TreeNode
          key={entry.path}
          entry={entry}
          depth={0}
          onReloadParent={onReloadRoot}
        />
      ))}
    </ul>
  );
}
