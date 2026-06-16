import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  File as FileIcon,
  Folder,
  FolderOpen,
} from "lucide-react";
import { fsReadDir, type DirEntry } from "./lib/fsBridge";
import { useWorkspaceStore } from "@/stores/workspaceStore";

interface TreeNodeProps {
  entry: DirEntry;
  depth: number;
}

function TreeNode({ entry, depth }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<DirEntry[] | null>(null);
  const openFile = useWorkspaceStore((s) => s.openFile);
  const activeFile = useWorkspaceStore((s) => s.activeFile);
  const isActive = !entry.is_dir && activeFile === entry.path;

  async function toggle() {
    if (!entry.is_dir) {
      openFile(entry.path);
      return;
    }
    const next = !expanded;
    setExpanded(next);
    if (next && children === null) {
      try {
        setChildren(await fsReadDir(entry.path));
      } catch {
        setChildren([]);
      }
    }
  }

  return (
    <li>
      <button
        type="button"
        onClick={toggle}
        title={entry.name}
        style={{ paddingLeft: depth * 12 + 8 }}
        className={`flex w-full items-center gap-1.5 py-1 pr-2 text-left text-sm transition-colors ${
          isActive
            ? "bg-bg-elevated text-fg"
            : "text-fg-muted hover:bg-bg-elevated/60"
        }`}
      >
        {entry.is_dir ? (
          <>
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            {expanded ? (
              <FolderOpen size={15} className="text-accent" />
            ) : (
              <Folder size={15} className="text-accent" />
            )}
          </>
        ) : (
          <>
            <span className="w-[14px]" />
            <FileIcon size={15} className="text-fg-subtle" />
          </>
        )}
        <span className="truncate">{entry.name}</span>
      </button>
      {entry.is_dir && expanded && children && children.length > 0 && (
        <ul>
          {children.map((child) => (
            <TreeNode key={child.path} entry={child} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function FileTree({ entries }: { entries: DirEntry[] }) {
  return (
    <ul className="select-none">
      {entries.map((entry) => (
        <TreeNode key={entry.path} entry={entry} depth={0} />
      ))}
    </ul>
  );
}
