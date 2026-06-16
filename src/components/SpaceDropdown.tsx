import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronRight,
  FileCode,
  Pencil,
  Plus,
  SquareTerminal,
  Trash2,
} from "lucide-react";
import { useTabsStore, type Tab } from "@/stores/tabsStore";

function tabSubtitle(tab: Tab): string {
  switch (tab.kind) {
    case "terminal":
      return tab.cwd ?? "";
    case "editor":
      return tab.path;
    case "preview":
      return tab.url;
    default:
      return "";
  }
}

export function SpaceDropdown() {
  const { t } = useTranslation();
  const spaces = useTabsStore((s) => s.spaces);
  const activeSpaceId = useTabsStore((s) => s.activeSpaceId);
  const tabs = useTabsStore((s) => s.tabs);
  const setActiveSpace = useTabsStore((s) => s.setActiveSpace);
  const setActive = useTabsStore((s) => s.setActive);
  const newSpace = useTabsStore((s) => s.newSpace);
  const renameSpace = useTabsStore((s) => s.renameSpace);
  const deleteSpace = useTabsStore((s) => s.deleteSpace);

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  function startRename(id: string, name: string) {
    setEditingId(id);
    setDraft(name);
  }
  function commitRename() {
    if (editingId && draft.trim()) {
      renameSpace(editingId, draft.trim());
    }
    setEditingId(null);
  }

  useEffect(() => {
    if (!open) {
      return;
    }
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const activeSpace = spaces.find((s) => s.id === activeSpaceId);
  const label = activeSpace?.name ?? t("workspace.spaces");

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-7 items-center gap-1.5 rounded-md px-3 text-xs font-semibold text-fg transition-colors hover:bg-bg-elevated"
      >
        {label}
        <ChevronRight size={13} className={`transition-transform ${open ? "rotate-90" : ""}`} />
      </button>

      {open && (
        <div className="absolute left-0 top-9 z-50 w-72 overflow-hidden rounded-xl border border-border-strong bg-bg-elevated py-2 shadow-2xl">
          <div className="px-3 pb-1 text-[11px] font-bold uppercase tracking-wider text-fg-subtle">
            {t("workspace.spaces")}
          </div>

          {spaces.map((space) => {
            const spaceTabs = tabs.filter((tb) => tb.spaceId === space.id);
            return (
              <div key={space.id} className="group/space mb-1">
                <div
                  className={`flex w-full items-center gap-2 px-3 py-1.5 ${
                    space.id === activeSpaceId ? "text-fg" : "text-fg-muted"
                  }`}
                >
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-accent/20 text-[11px] font-bold text-accent">
                    {space.name.charAt(0).toUpperCase()}
                  </span>
                  {editingId === space.id ? (
                    <input
                      autoFocus
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitRename();
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      className="min-w-0 flex-1 rounded border border-accent bg-bg px-1 py-0.5 text-sm text-fg outline-none"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => setActiveSpace(space.id)}
                      className="min-w-0 flex-1 truncate text-left text-sm font-medium hover:text-fg"
                    >
                      {space.name}
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label={t("workspace.renameSpace")}
                    title={t("workspace.renameSpace")}
                    onClick={() => startRename(space.id, space.name)}
                    className="rounded p-0.5 text-fg-subtle opacity-0 hover:text-fg group-hover/space:opacity-100"
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    type="button"
                    aria-label={t("workspace.deleteSpace")}
                    title={t("workspace.deleteSpace")}
                    onClick={() => deleteSpace(space.id)}
                    className="rounded p-0.5 text-fg-subtle opacity-0 hover:text-danger group-hover/space:opacity-100"
                  >
                    <Trash2 size={12} />
                  </button>
                  <span className="text-xs text-fg-subtle">{spaceTabs.length}</span>
                </div>
                <ul className="ml-2">
                  {spaceTabs.map((tb) => {
                    const Icon = tb.kind === "terminal" ? SquareTerminal : FileCode;
                    return (
                      <li key={tb.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setActive(tb.id);
                            setOpen(false);
                          }}
                          className="flex w-full items-center gap-2 rounded-md px-3 py-1 text-left hover:bg-bg"
                        >
                          <Icon size={14} className="shrink-0 text-fg-subtle" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm text-fg-muted">{tb.title}</span>
                            <span className="block truncate text-[11px] text-fg-subtle">
                              {tabSubtitle(tb)}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}

          <div className="mt-1 border-t border-border px-1 pt-1">
            <button
              type="button"
              onClick={() => {
                newSpace();
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-fg-muted hover:bg-bg hover:text-fg"
            >
              <Plus size={15} />
              {t("workspace.newSpace")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
