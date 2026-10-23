import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, MessageSquare, Search, Server } from "lucide-react";
import { fsListFiles, canSearchRoot } from "@/modules/explorer/lib/fsBridge";
import { fuzzyMatch } from "@/modules/explorer/lib/fuzzy";
import { basename, relativeDirOf, relativePath } from "@/modules/explorer/lib/paths";
import { useRecentFilesStore } from "@/modules/explorer/lib/recentFiles";
import { FileIcon } from "@/modules/explorer/components/FileIcon";
import { useSessionsStore } from "@/modules/sessions/lib/sessionsStore";
import { ConnectionForm } from "@/modules/ssh/ConnectionForm";
import { InfoDialog } from "@/components/InfoDialog";
import { useOverlayGuard } from "@/lib/overlayGuard";
import { IS_MAC } from "@/lib/platform";
import { useConnectionsStore } from "@/stores/connectionsStore";
import { useTabsStore } from "@/stores/tabsStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useLauncherActions } from "./LauncherPanel";
import {
  buildMenus,
  executeMenuAction,
  getMenuContext,
  type MenuItemDef,
} from "./menuBarMenus";

export type PaletteCategory = "all" | "commands" | "files" | "sessions" | "hosts";

const CATEGORIES: PaletteCategory[] = ["all", "commands", "files", "sessions", "hosts"];

/** Clipboard items act on whatever had focus before the palette took it, so
 *  running them from here would act on the palette's own input instead; the
 *  palette's own entry would only reopen it. */
const EXCLUDED_MENU_ITEMS = new Set(["copy", "paste", "select-all", "command-palette"]);

/** i18n keys of the launcher actions, so their English labels stay
 *  searchable when the interface is in another language. */
const LAUNCHER_LABEL_KEYS: Record<string, string> = {
  terminal: "workspace.terminal",
  folder: "workspace.openFolder",
  "connect-ssh": "workspace.connectSsh",
  note: "workspace.note",
  preview: "preview:title",
  "git-graph": "nav.gitGraph",
};

/** How many files, sessions or hosts the All tab shows per section. */
const ALL_SECTION_LIMIT = 5;
/** Upper bound on rows in a single-category list. */
const CATEGORY_LIMIT = 50;
/** Upper bound on files listed from the workspace, as in the file finder. */
const FILE_LIST_LIMIT = 20000;

interface PaletteItem {
  key: string;
  category: Exclude<PaletteCategory, "all">;
  /** Section heading the item is listed under. */
  group: string;
  label: string;
  /** Secondary text after the label, such as a folder or a host address. */
  detail?: string;
  /** Text matched against the query. */
  searchText: string;
  icon: ReactNode;
  shortcut?: string;
  /** Returns false when the palette must stay mounted after the action. */
  run: () => boolean | void;
}

interface CommandPaletteProps {
  onClose: () => void;
}

/**
 * The command palette (⌘P, Ctrl+P on Windows), opened from the shortcut or the
 * tab bar. It searches menu and launcher commands, workspace files, AI
 * sessions and SSH hosts, either all together or one category at a time.
 */
export function CommandPalette({ onClose }: CommandPaletteProps) {
  const { t, i18n } = useTranslation();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<PaletteCategory>("all");
  const [activeIndex, setActiveIndex] = useState(0);
  const [files, setFiles] = useState<string[]>([]);
  const [dialog, setDialog] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeRowRef = useRef<HTMLButtonElement | null>(null);

  const rootPath = useWorkspaceStore((s) => s.rootPath);
  const recentPaths = useRecentFilesStore((s) => s.paths);
  const addRecent = useRecentFilesStore((s) => s.addRecent);
  const sessions = useSessionsStore((s) => s.sessions);
  const connections = useConnectionsStore((s) => s.connections);
  const openFromSidebar = useTabsStore((s) => s.openFromSidebar);
  const openSessionsTab = useTabsStore((s) => s.openSessionsTab);
  const { groups: launcherGroups, sshFormOpen, setSshFormOpen } = useLauncherActions();

  // The native preview webview floats above all DOM, so hide it while open.
  useOverlayGuard(true);

  useEffect(() => {
    inputRef.current?.focus();
    void useSessionsStore.getState().start();
  }, []);

  const searchableRoot = canSearchRoot(rootPath) ? rootPath : null;
  useEffect(() => {
    if (!searchableRoot) {
      setFiles([]);
      return;
    }
    let cancelled = false;
    fsListFiles(searchableRoot, FILE_LIST_LIMIT)
      .then((list) => {
        if (!cancelled) {
          setFiles(list);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [searchableRoot]);

  const commandItems = useMemo<PaletteItem[]>(() => {
    const items: PaletteItem[] = [];
    // Commands match their English name as well, so "terminal" finds the
    // terminal command in any interface language.
    const tEn = i18n.getFixedT("en");
    const withEnglish = (label: string, key: string | undefined) => {
      const english = key ? tEn(key) : "";
      return english && english !== label ? `${label} ${english}` : label;
    };
    for (const group of launcherGroups) {
      for (const action of group.actions) {
        const Icon = action.icon;
        items.push({
          key: `launcher:${action.key}`,
          category: "commands",
          group: group.label,
          label: action.label,
          searchText: withEnglish(action.label, LAUNCHER_LABEL_KEYS[action.key]),
          icon: <Icon size={15} />,
          shortcut: action.key === "terminal" ? (IS_MAC ? "⌘T" : "Ctrl+T") : undefined,
          run: () => {
            if (action.key === "connect-ssh") {
              setSshFormOpen(true);
              return false;
            }
            void action.run();
          },
        });
      }
    }
    const ctx = getMenuContext(false);
    const pushMenuItem = (item: MenuItemDef, group: string, prefix?: string) => {
      if (EXCLUDED_MENU_ITEMS.has(item.id) || item.disabled?.(ctx) || !item.action) {
        return;
      }
      const action = item.action;
      const label = prefix ? `${prefix}: ${t(item.labelKey)}` : t(item.labelKey);
      items.push({
        key: `menu:${item.id}`,
        category: "commands",
        group,
        label,
        searchText: withEnglish(label, item.labelKey),
        icon: <ChevronRight size={15} />,
        shortcut: item.shortcut ? (IS_MAC ? item.shortcut.mac : item.shortcut.win) : undefined,
        run: () => executeMenuAction(action),
      });
    };
    for (const menu of buildMenus(ctx)) {
      const group = t(menu.labelKey);
      for (const item of menu.items) {
        if (item.submenu) {
          for (const sub of item.submenu) {
            pushMenuItem(sub, group, t(item.labelKey));
          }
        } else {
          pushMenuItem(item, group);
        }
      }
    }
    return items;
    // launcherGroups is rebuilt on every render; its labels only change with t.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, i18n]);

  const fileItems = useMemo<PaletteItem[]>(() => {
    if (!searchableRoot) {
      return [];
    }
    const group = t("commandPalette.categories.files");
    return files.map((path) => {
      const relative = relativePath(path, searchableRoot);
      return {
        key: `file:${path}`,
        category: "files",
        group,
        label: basename(path),
        detail: relativeDirOf(relative) || undefined,
        searchText: relative,
        icon: <FileIcon name={basename(path)} isDir={false} />,
        run: () => {
          const result = openFromSidebar({ kind: "editor", path });
          if (result.status === "at-capacity") {
            setDialog(t("paneCapacityAlert"));
            return false;
          }
          addRecent(path);
        },
      };
    });
  }, [files, searchableRoot, t, openFromSidebar, addRecent]);

  const recentFileItems = useMemo(() => {
    const byPath = new Map(fileItems.map((item) => [item.key, item]));
    return recentPaths
      .map((path) => byPath.get(`file:${path}`))
      .filter((item): item is PaletteItem => item !== undefined);
  }, [fileItems, recentPaths]);

  const sessionItems = useMemo<PaletteItem[]>(() => {
    const group = t("commandPalette.categories.sessions");
    return [...sessions]
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.ended_at - a.ended_at)
      .map((session) => {
        const project = session.project_cwd ? basename(session.project_cwd) : "";
        return {
          key: `session:${session.agent}:${session.id}`,
          category: "sessions",
          group,
          label: session.title,
          detail: [t(`sessions.agents.${session.agent}`), project].filter(Boolean).join(" · "),
          searchText: `${session.title} ${project}`,
          icon: <MessageSquare size={15} />,
          run: () => {
            useSessionsStore.getState().select(session.id);
            openSessionsTab();
          },
        };
      });
  }, [sessions, t, openSessionsTab]);

  const hostItems = useMemo<PaletteItem[]>(() => {
    const group = t("commandPalette.categories.hosts");
    return connections.map((connection) => {
      const address = `${connection.user ? `${connection.user}@` : ""}${connection.host}${
        connection.port !== 22 ? `:${connection.port}` : ""
      }`;
      return {
        key: `host:${connection.id}`,
        category: "hosts",
        group,
        label: connection.name,
        detail: address,
        searchText: `${connection.name} ${address}`,
        icon: <Server size={15} />,
        run: () => {
          const result = openFromSidebar(
            { kind: "terminal", ssh: { connectionId: connection.id } },
            connection.name,
          );
          if (result.status === "already-connected") {
            setDialog(t("connectionsPanel.alreadyOpenAlert", { name: connection.name }));
            return false;
          }
          if (result.status === "at-capacity") {
            setDialog(t("paneCapacityAlert"));
            return false;
          }
        },
      };
    });
  }, [connections, t, openFromSidebar]);

  const results = useMemo(() => {
    const filter = (items: PaletteItem[], limit: number) => {
      if (query.trim() === "") {
        return items.slice(0, limit);
      }
      return items
        .map((item) => ({ item, match: fuzzyMatch(query, item.searchText) }))
        .filter(({ match }) => match.matched)
        .sort((a, b) => b.match.score - a.match.score)
        .slice(0, limit)
        .map(({ item }) => item);
    };
    const empty = query.trim() === "";
    switch (category) {
      case "commands":
        return filter(commandItems, Infinity);
      case "files":
        return filter(empty ? recentFileItems : fileItems, CATEGORY_LIMIT);
      case "sessions":
        return filter(sessionItems, CATEGORY_LIMIT);
      case "hosts":
        return filter(hostItems, CATEGORY_LIMIT);
      case "all":
        return [
          ...filter(commandItems, Infinity),
          ...filter(empty ? recentFileItems : fileItems, ALL_SECTION_LIMIT),
          ...filter(sessionItems, ALL_SECTION_LIMIT),
          ...filter(hostItems, ALL_SECTION_LIMIT),
        ];
    }
  }, [query, category, commandItems, fileItems, recentFileItems, sessionItems, hostItems]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, category]);

  useEffect(() => {
    activeRowRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, results]);

  function runItem(item: PaletteItem) {
    if (item.run() !== false) {
      onClose();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    // While an IME candidate window is open, these keys belong to it.
    if (e.nativeEvent.isComposing || e.keyCode === 229) {
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (results.length ? (i + 1) % results.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (results.length ? (i - 1 + results.length) % results.length : 0));
    } else if (e.key === "Tab") {
      e.preventDefault();
      const step = e.shiftKey ? -1 : 1;
      setCategory((c) => CATEGORIES[(CATEGORIES.indexOf(c) + step + CATEGORIES.length) % CATEGORIES.length]);
    } else if (e.key === "Enter" && results[activeIndex]) {
      e.preventDefault();
      runItem(results[activeIndex]);
    }
  }

  if (sshFormOpen) {
    return (
      <ConnectionForm
        onClose={() => {
          setSshFormOpen(false);
          onClose();
        }}
      />
    );
  }

  const emptyMessage =
    category === "files" && !searchableRoot
      ? t("commandPalette.noFolder")
      : t("commandPalette.noResults");

  return (
    <div
      className="fixed inset-0 z-[90] flex justify-center bg-black/40 pt-16"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-label={t("commandPalette.title")}
        className="flex h-fit max-h-[70vh] w-[90%] max-w-2xl flex-col overflow-hidden rounded-xl border border-border-strong bg-bg-elevated shadow-2xl md:w-[70%]"
      >
        <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
          <Search size={16} className="shrink-0 text-fg-subtle" />
          <input
            ref={inputRef}
            value={query}
            placeholder={t("commandPalette.placeholder")}
            aria-label={t("commandPalette.title")}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            className="w-full bg-transparent text-sm text-fg outline-none placeholder:text-fg-subtle"
          />
          <Kbd>esc</Kbd>
        </div>

        <div role="tablist" className="flex shrink-0 items-center gap-1 px-3 pt-2.5">
          {CATEGORIES.map((key) => {
            const selected = key === category;
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => {
                  setCategory(key);
                  inputRef.current?.focus();
                }}
                className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                  selected
                    ? "border-accent/40 bg-accent/15 text-accent"
                    : "border-transparent text-fg-muted hover:text-fg"
                }`}
              >
                {t(`commandPalette.categories.${key}`)}
              </button>
            );
          })}
        </div>

        <ul role="listbox" aria-label={t("commandPalette.title")} className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {results.length === 0 ? (
            <li className="px-3 py-2 text-xs text-fg-subtle">{emptyMessage}</li>
          ) : (
            results.map((item, index) => {
              const active = index === activeIndex;
              const showGroup = index === 0 || results[index - 1].group !== item.group;
              return (
                <li key={item.key}>
                  {showGroup && (
                    <div className="px-2 pb-1 pt-2.5 text-[11px] font-medium text-fg-subtle">
                      {item.group}
                    </div>
                  )}
                  <button
                    ref={active ? activeRowRef : undefined}
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => runItem(item)}
                    // mousemove, not mouseenter, so a row scrolled under a
                    // still cursor does not take the selection from the keyboard.
                    onMouseMove={() => {
                      if (activeIndex !== index) {
                        setActiveIndex(index);
                      }
                    }}
                    className={`relative flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm ${
                      active ? "bg-bg text-fg" : "text-fg-muted"
                    }`}
                  >
                    {active && (
                      <span className="absolute -left-1 top-1.5 bottom-1.5 w-0.5 rounded-full bg-accent" />
                    )}
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border bg-bg-inset text-fg-muted">
                      {item.icon}
                    </span>
                    <span className="min-w-0 truncate">{item.label}</span>
                    {item.detail && (
                      <span className="min-w-0 max-w-[40%] shrink truncate text-xs text-fg-subtle">
                        {item.detail}
                      </span>
                    )}
                    <span className="flex-1" />
                    {item.shortcut && <Kbd>{item.shortcut}</Kbd>}
                  </button>
                </li>
              );
            })
          )}
        </ul>

        <div className="flex shrink-0 items-center gap-4 border-t border-border px-4 py-2 text-xs text-fg-subtle">
          <span className="flex items-center gap-1.5">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd>
            {t("commandPalette.navigate")}
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>↵</Kbd>
            {t("commandPalette.run")}
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>tab</Kbd>
            {t("commandPalette.switchCategory")}
          </span>
          <span className="flex-1" />
          <span className="flex items-center gap-1.5">
            <Kbd>esc</Kbd>
            {t("commandPalette.close")}
          </span>
        </div>
      </div>

      {dialog && (
        <InfoDialog
          title={t("commandPalette.title")}
          message={dialog}
          confirmLabel={t("actions.confirm")}
          onConfirm={() => setDialog(null)}
        />
      )}
    </div>
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="shrink-0 rounded border border-border-strong bg-bg-inset px-1.5 py-0.5 font-mono text-[11px] text-fg-muted">
      {children}
    </kbd>
  );
}
