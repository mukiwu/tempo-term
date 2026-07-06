import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { uid } from "@/lib/id";
import { perWindowStorage } from "@/lib/window";
import { markFreshSshLeaf } from "@/modules/ssh/lib/freshSshLeaves";
import { decideHtmlPreviewOpen, previewLocalPath } from "@/modules/preview/lib/htmlPreviewTarget";
import { fileUrl } from "@/modules/explorer/lib/dragEntry";
import {
  computeLayout,
  findPaneContent,
  gridLayout,
  leaf,
  leafIds,
  paneOf,
  removeLeaf,
  setLeafPane,
  setSizesById,
  splitLeaf,
  wrapTree,
  type LayoutNode,
  type OrderedPane,
  type PaneContent,
  type SplitDirection,
} from "@/modules/terminal/lib/terminalLayout";

/**
 * Tabs grouped into spaces. A space is a context (like a window) that holds its
 * own set of tabs. Every tab owns a recursive split paneTree, so any tab can be
 * split into panes of mixed content (terminal/editor/note/preview/git-graph),
 * just like a terminal tab. Tabs stay mounted when inactive (hidden) so
 * terminals keep running.
 */
export interface Space {
  id: string;
  name: string;
}

export type OpenFromSidebarResult =
  | { status: "opened" }
  | { status: "already-connected" }
  | { status: "at-capacity" };

export type TabKind =
  | "terminal"
  | "editor"
  | "note"
  | "preview"
  | "git-graph"
  | "diff"
  | "sessions"
  | "launcher";

/**
 * A single tab. `kind` is only the tab's creation type, used for the tab-bar
 * icon and open-dedup; it does not have to match a split's mixed contents (a
 * terminal tab split with an editor still shows the terminal icon).
 */
export interface Tab {
  id: string;
  spaceId: string;
  title: string;
  kind: TabKind;
  paneTree: LayoutNode;
  activeLeafId: string;
  /** Leaf ids in the order they were added to this tab — independent of the
   * tree's own left-right shape, which the grid layout's stacking scrambles.
   * Drives `gridLayout`'s column/row assignment. */
  paneOrder: string[];
  /** Starting directory for new terminal panes created inside this tab. */
  cwd?: string;
  /** True once the user renames the tab, so cwd changes stop overwriting it. */
  renamed?: boolean;
}

interface TabsState {
  spaces: Space[];
  activeSpaceId: string | null;
  tabs: Tab[];
  activeId: string | null;
  ensureSpace: () => string;
  newSpace: (name?: string) => string;
  setActiveSpace: (id: string) => void;
  renameSpace: (id: string, name: string) => void;
  deleteSpace: (id: string) => void;
  newTerminalTab: (cwd?: string) => string;
  /** Open a terminal tab wired to an SSH connection. The tab is user-named (renamed=true) so cwd sync never overwrites the title. */
  openSshTab: (connectionId: string, name: string) => string;
  /** A blank "new tab" showing the launcher; reused if one already exists. */
  openLauncherTab: () => string;
  openEditorTab: (path: string) => string;
  openNoteTab: (noteId: string, title: string) => string;
  openPreviewTab: (url: string) => string;
  openGitGraphTab: () => string;
  openDiffTab: (path: string, staged: boolean) => string;
  /** Open the AI sessions browser tab (singleton per space). */
  openSessionsTab: () => string;
  /**
   * Open sidebar content (explorer file, note, or SSH connection). When the
   * active tab is a real working tab, this splits beside its current
   * right-most pane. When there is no active tab, or the active tab is a
   * Launcher tab (kind === "launcher" — TabsArea.tsx renders LauncherPanel
   * for those directly and ignores their paneTree), this opens a fresh tab
   * and, for the launcher case, closes the old one — the same two-step
   * LauncherPanel's own newTab actions already do. Unlike openEditorTab /
   * openNoteTab / openSshTab, this never focuses an existing pane showing the
   * same content — duplicates are allowed. SSH content is checked for an
   * already-open connection in a later task.
   */
  openFromSidebar: (content: PaneContent, title?: string) => OpenFromSidebarResult;
  /**
   * Open sidebar content in a brand-new tab, unconditionally — never splits
   * into the active tab, never touches/closes a Launcher tab. The explicit
   * escape hatch from openFromSidebar's default splitting behavior. SSH
   * content is still blocked from duplicating a connection already open
   * anywhere in the space, same guard as openFromSidebar.
   */
  openInNewTab: (content: PaneContent, title?: string) => OpenFromSidebarResult;
  /**
   * Open the web preview of a local HTML file with a smart target: reuse an
   * existing preview pane in this tab, else split beside a single-pane editor,
   * else open/reuse a per-space preview tab.
   */
  openHtmlPreview: (tabId: string, fromLeafId: string, filePath: string) => void;
  setTabTitle: (id: string, title: string) => void;
  /** Update a terminal tab's title to follow its cwd, unless the user renamed it. */
  syncTabTitleToCwd: (id: string, cwd: string) => void;
  closeTab: (id: string) => void;
  /**
   * Close the next pane of the active tab in reverse reading order (bottom-most,
   * then right-most), falling back to closing the whole tab when one pane is left.
   */
  closePaneOrTab: () => void;
  setActive: (id: string) => void;
  /** Move `activeId` to `overId`'s slot within the same space. No-op across spaces. */
  reorderTab: (activeId: string, overId: string) => void;
  splitActivePane: (direction: SplitDirection) => void;
  setActiveLeaf: (tabId: string, leafId: string) => void;
  /** Cycle the active tab's focused pane to the next leaf (⌘`); wraps around. */
  focusNextPane: () => void;
  resizePane: (tabId: string, splitId: string, sizes: [number, number]) => void;
  /** Split a pane and show `content` (terminal/editor/note/preview) in the new half. Returns the new leaf's id. */
  splitPaneWith: (
    tabId: string,
    fromLeafId: string,
    content: PaneContent,
    direction: SplitDirection,
    anchor?: "before" | "after",
  ) => string;
  /**
   * Wrap the tab's whole current pane tree as one side of a brand-new
   * top-level split, with `content` on the other side. Used for the
   * outer-edge drop zone (spec section C) — every existing pane shifts over
   * as a block instead of any single pane being split. Returns the new
   * leaf's id.
   */
  wrapPaneWith: (
    tabId: string,
    content: PaneContent,
    direction: SplitDirection,
    anchor: "before" | "after",
  ) => string;
  /**
   * Follow an in-preview navigation: update the pane's previewed url, and when
   * the preview is the tab's whole content (single pane, not user-renamed),
   * retitle the tab to the new host.
   */
  navigatePreview: (tabId: string, leafId: string, url: string) => void;
  /**
   * Retitle a tab from a preview page's real `<title>`. Applies only when the
   * preview is the tab's whole content (single pane, not user-renamed), and
   * ignores empty titles.
   */
  setPreviewTabTitle: (tabId: string, leafId: string, title: string) => void;
  /** Replace a pane's content in place (used when dropping a file onto it). */
  setPaneContent: (tabId: string, leafId: string, content: PaneContent) => void;
  /** Remember a terminal pane's current working directory for session restore. */
  setTerminalCwd: (tabId: string, leafId: string, cwd: string) => void;
  closePane: (tabId: string, leafId: string) => void;
}

const nextTabId = () => uid("tab");
const nextPaneId = () => uid("pane");
const nextSpaceId = () => uid("space");

function basename(path: string): string {
  const seg = path.replace(/[\\/]+$/, "").split(/[\\/]/).pop();
  return seg && seg.length > 0 ? seg : path;
}

function neighbourId(tabs: Tab[], index: number): string | null {
  return tabs[index - 1]?.id ?? tabs[index]?.id ?? null;
}

/** Return a copy of `items` with the element at `from` moved to `to`. */
function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const next = items.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/**
 * The file path of the editor the user is currently focused on, derived from
 * the active tab's active leaf so it follows what is actually on screen (including
 * the focused pane of a split). Returns null when the focused pane is not an
 * editor. This is the source of truth for "the file the user is looking at" —
 * the legacy workspaceStore.activeFile was never wired up to tab navigation.
 */
export function activeEditorPath(
  tabs: readonly Tab[],
  activeId: string | null,
): string | null {
  const tab = tabs.find((t) => t.id === activeId);
  if (!tab) {
    return null;
  }
  const content = findPaneContent(tab.paneTree, tab.activeLeafId);
  return content?.kind === "editor" ? content.path : null;
}

export function tabHasDirtyEditor(
  tab: Tab,
  buffers: Record<string, { content: string; baseline: string }>,
): boolean {
  return computeLayout(tab.paneTree).some((p) => {
    if (p.content.kind !== "editor") return false;
    const buf = buffers[p.content.path];
    return buf ? buf.content !== buf.baseline : false;
  });
}

/** Every distinct file path currently shown in an editor pane, across all tabs. */
export function openEditorPaths(tabs: Tab[]): string[] {
  const paths = new Set<string>();
  for (const tab of tabs) {
    for (const pane of computeLayout(tab.paneTree)) {
      if (pane.content.kind === "editor") {
        paths.add(pane.content.path);
      }
    }
  }
  return [...paths];
}

/** Absolute paths of local-file preview panes across all tabs, for file watching. */
export function localPreviewFilePaths(tabs: Tab[]): string[] {
  const paths: string[] = [];
  for (const tab of tabs) {
    for (const id of leafIds(tab.paneTree)) {
      const content = findPaneContent(tab.paneTree, id);
      if (content?.kind === "preview") {
        const local = previewLocalPath(content.url);
        if (local) {
          paths.push(local);
        }
      }
    }
  }
  return paths;
}

/**
 * Title for a web preview tab: the URL's host (with port), falling back to the
 * raw string when it can't be parsed (e.g. a `file://` local preview).
 */
function previewTitle(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

/** True when a tab is a single, unsplit leaf showing exactly `content`. */
function singleLeafContentEquals(tab: Tab, content: PaneContent): boolean {
  if (tab.paneTree.kind !== "leaf") {
    return false;
  }
  const pane = paneOf(tab.paneTree);
  if (pane.kind !== content.kind) {
    return false;
  }
  if (pane.kind === "editor" && content.kind === "editor") {
    return pane.path === content.path;
  }
  if (pane.kind === "note" && content.kind === "note") {
    return pane.noteId === content.noteId;
  }
  if (pane.kind === "preview" && content.kind === "preview") {
    return pane.url === content.url;
  }
  if (pane.kind === "diff" && content.kind === "diff") {
    return pane.path === content.path && pane.staged === content.staged;
  }
  return true;
}

/** True when `connectionId` is already open in some pane of some tab in `spaceId`. */
export function sshAlreadyOpen(tabs: Tab[], spaceId: string, connectionId: string): boolean {
  return tabs.some(
    (t) =>
      t.spaceId === spaceId &&
      computeLayout(t.paneTree).some(
        (p) => p.content.kind === "terminal" && p.content.ssh?.connectionId === connectionId,
      ),
  );
}

export const TABS_STORAGE_KEY = "tempoterm-tabs";

/** Shape of a tab as persisted before the unified paneTree model (v0). */
interface PersistedV0Tab {
  id: string;
  spaceId: string;
  title: string;
  kind: TabKind;
  path?: string;
  noteId?: string;
  url?: string;
  paneTree?: LayoutNode;
  activeLeafId?: string;
  cwd?: string;
}

/** Convert pre-paneTree (v0) persisted tabs into the unified Tab shape, and
 * backfill `paneOrder` (v1→v2) for tabs persisted before it existed — a
 * one-time best-effort guess from the tree's own left-right leaf order, since
 * the true add-order was never recorded before this field existed. */
export function migratePersistedTabs(persisted: unknown, _version: number): unknown {
  if (!persisted || typeof persisted !== "object") {
    return persisted;
  }
  const state = persisted as { tabs?: (PersistedV0Tab & { paneOrder?: string[] })[] };
  if (!Array.isArray(state.tabs)) {
    return persisted;
  }
  const tabs: Tab[] = state.tabs.map((t) => {
    if (t.kind === "terminal" && t.paneTree && t.activeLeafId) {
      return {
        id: t.id,
        spaceId: t.spaceId,
        title: t.title,
        kind: "terminal",
        paneTree: t.paneTree,
        activeLeafId: t.activeLeafId,
        paneOrder: t.paneOrder ?? leafIds(t.paneTree),
        cwd: t.cwd,
      };
    }
    const paneId = nextPaneId();
    let content: PaneContent;
    switch (t.kind) {
      case "editor":
        content = { kind: "editor", path: t.path ?? "" };
        break;
      case "note":
        content = { kind: "note", noteId: t.noteId ?? "" };
        break;
      case "preview":
        content = { kind: "preview", url: t.url ?? "" };
        break;
      case "git-graph":
        content = { kind: "git-graph" };
        break;
      default:
        content = { kind: "terminal" };
    }
    const paneTree = t.paneTree ?? leaf(paneId, content);
    const activeLeafId = t.activeLeafId ?? paneId;
    return {
      id: t.id,
      spaceId: t.spaceId,
      title: t.title,
      kind: t.kind,
      paneTree,
      activeLeafId,
      paneOrder: t.paneOrder ?? leafIds(paneTree),
      cwd: t.cwd,
    };
  });
  return { ...state, tabs };
}

export const useTabsStore = create<TabsState>()(
  persist(
    (set, get) => ({
  spaces: [],
  activeSpaceId: null,
  tabs: [],
  activeId: null,

  ensureSpace: () => {
    const current = get().activeSpaceId;
    if (current && get().spaces.some((s) => s.id === current)) {
      return current;
    }
    const id = nextSpaceId();
    const name = `Workspace ${get().spaces.length + 1}`;
    set((state) => ({ spaces: [...state.spaces, { id, name }], activeSpaceId: id }));
    return id;
  },

  newSpace: (name) => {
    const id = nextSpaceId();
    set((state) => ({
      spaces: [...state.spaces, { id, name: name ?? `Workspace ${state.spaces.length + 1}` }],
      activeSpaceId: id,
      activeId: null,
    }));
    return id;
  },

  setActiveSpace: (id) =>
    set((state) => {
      const firstTab = state.tabs.find((t) => t.spaceId === id);
      return { activeSpaceId: id, activeId: firstTab ? firstTab.id : null };
    }),

  renameSpace: (id, name) =>
    set((state) => ({
      spaces: state.spaces.map((s) => (s.id === id ? { ...s, name } : s)),
    })),

  deleteSpace: (id) =>
    set((state) => {
      const spaces = state.spaces.filter((s) => s.id !== id);
      const tabs = state.tabs.filter((t) => t.spaceId !== id);
      let { activeSpaceId, activeId } = state;
      if (activeSpaceId === id) {
        activeSpaceId = spaces[0]?.id ?? null;
        activeId = tabs.find((t) => t.spaceId === activeSpaceId)?.id ?? null;
      }
      return { spaces, tabs, activeSpaceId, activeId };
    }),

  newTerminalTab: (cwd) => {
    const spaceId = get().ensureSpace();
    const id = nextTabId();
    const paneId = nextPaneId();
    const count = get().tabs.filter((t) => t.kind === "terminal").length + 1;
    const tab: Tab = {
      id,
      spaceId,
      kind: "terminal",
      title: cwd ? basename(cwd) : `Terminal ${count}`,
      paneTree: leaf(paneId, { kind: "terminal" }),
      activeLeafId: paneId,
      paneOrder: [paneId],
      cwd,
    };
    set((state) => ({ tabs: [...state.tabs, tab], activeId: id }));
    return id;
  },

  openSshTab: (connectionId, name) => {
    const spaceId = get().ensureSpace();
    // Re-opening a connection that's already showing in this space focuses that
    // tab instead of spawning a duplicate session (two sessions would race for
    // the same forwarded local port). Matches openLauncherTab's reuse.
    const existing = get().tabs.find(
      (t) =>
        t.spaceId === spaceId &&
        computeLayout(t.paneTree).some(
          (p) =>
            p.content.kind === "terminal" && p.content.ssh?.connectionId === connectionId,
        ),
    );
    if (existing) {
      set({ activeId: existing.id });
      return existing.id;
    }
    const id = nextTabId();
    const paneId = nextPaneId();
    const tab: Tab = {
      id,
      spaceId,
      kind: "terminal",
      title: name,
      paneTree: leaf(paneId, { kind: "terminal", ssh: { connectionId } }),
      activeLeafId: paneId,
      paneOrder: [paneId],
      renamed: true,
    };
    // Mark this leaf as freshly user-opened so TerminalView auto-connects on mount.
    // Restored panes (after app relaunch) never reach this path, so their leaf ids
    // will NOT be in the set and TerminalView will show the Reconnect state instead.
    markFreshSshLeaf(paneId);
    set((state) => ({ tabs: [...state.tabs, tab], activeId: id }));
    return id;
  },

  openLauncherTab: () => {
    const spaceId = get().ensureSpace();
    const existing = get().tabs.find((t) => t.kind === "launcher" && t.spaceId === spaceId);
    if (existing) {
      set({ activeId: existing.id });
      return existing.id;
    }
    const id = nextTabId();
    const paneId = nextPaneId();
    const tab: Tab = {
      id,
      spaceId,
      kind: "launcher",
      title: "New Tab",
      paneTree: leaf(paneId, { kind: "terminal" }),
      activeLeafId: paneId,
      paneOrder: [paneId],
    };
    set((state) => ({ tabs: [...state.tabs, tab], activeId: id }));
    return id;
  },

  openEditorTab: (path) => {
    const spaceId = get().ensureSpace();
    const existing = get().tabs.find(
      (t) =>
        t.kind === "editor" &&
        t.spaceId === spaceId &&
        singleLeafContentEquals(t, { kind: "editor", path }),
    );
    if (existing) {
      set({ activeId: existing.id });
      return existing.id;
    }
    const id = nextTabId();
    const paneId = nextPaneId();
    const tab: Tab = {
      id,
      spaceId,
      kind: "editor",
      title: basename(path),
      paneTree: leaf(paneId, { kind: "editor", path }),
      activeLeafId: paneId,
      paneOrder: [paneId],
    };
    set((state) => ({ tabs: [...state.tabs, tab], activeId: id }));
    return id;
  },

  openNoteTab: (noteId, title) => {
    const spaceId = get().ensureSpace();
    const existing = get().tabs.find(
      (t) =>
        t.kind === "note" &&
        t.spaceId === spaceId &&
        singleLeafContentEquals(t, { kind: "note", noteId }),
    );
    if (existing) {
      set({ activeId: existing.id });
      return existing.id;
    }
    const id = nextTabId();
    const paneId = nextPaneId();
    const tab: Tab = {
      id,
      spaceId,
      kind: "note",
      title: title || "Untitled",
      paneTree: leaf(paneId, { kind: "note", noteId }),
      activeLeafId: paneId,
      paneOrder: [paneId],
    };
    set((state) => ({ tabs: [...state.tabs, tab], activeId: id }));
    return id;
  },

  openPreviewTab: (url) => {
    const spaceId = get().ensureSpace();
    const id = nextTabId();
    const paneId = nextPaneId();
    const tab: Tab = {
      id,
      spaceId,
      kind: "preview",
      title: previewTitle(url),
      paneTree: leaf(paneId, { kind: "preview", url }),
      activeLeafId: paneId,
      paneOrder: [paneId],
    };
    set((state) => ({ tabs: [...state.tabs, tab], activeId: id }));
    return id;
  },

  openGitGraphTab: () => {
    const spaceId = get().ensureSpace();
    const existing = get().tabs.find(
      (t) =>
        t.kind === "git-graph" &&
        t.spaceId === spaceId &&
        singleLeafContentEquals(t, { kind: "git-graph" }),
    );
    if (existing) {
      set({ activeId: existing.id });
      return existing.id;
    }
    const id = nextTabId();
    const paneId = nextPaneId();
    const tab: Tab = {
      id,
      spaceId,
      kind: "git-graph",
      title: "Git Graph",
      paneTree: leaf(paneId, { kind: "git-graph" }),
      activeLeafId: paneId,
      paneOrder: [paneId],
    };
    set((state) => ({ tabs: [...state.tabs, tab], activeId: id }));
    return id;
  },

  openSessionsTab: () => {
    const spaceId = get().ensureSpace();
    const existing = get().tabs.find(
      (t) =>
        t.kind === "sessions" &&
        t.spaceId === spaceId &&
        singleLeafContentEquals(t, { kind: "sessions" }),
    );
    if (existing) {
      set({ activeId: existing.id });
      return existing.id;
    }
    const id = nextTabId();
    const paneId = nextPaneId();
    const tab: Tab = {
      id,
      spaceId,
      kind: "sessions",
      title: "AI Sessions",
      paneTree: leaf(paneId, { kind: "sessions" }),
      activeLeafId: paneId,
      paneOrder: [paneId],
    };
    set((state) => ({ tabs: [...state.tabs, tab], activeId: id }));
    return id;
  },

  openDiffTab: (path, staged) => {
    const spaceId = get().ensureSpace();
    const existing = get().tabs.find(
      (t) =>
        t.kind === "diff" &&
        t.spaceId === spaceId &&
        singleLeafContentEquals(t, { kind: "diff", path, staged }),
    );
    if (existing) {
      set({ activeId: existing.id });
      return existing.id;
    }
    const id = nextTabId();
    const paneId = nextPaneId();
    const tab: Tab = {
      id,
      spaceId,
      kind: "diff",
      title: path.split(/[\\/]/).pop() ?? path,
      paneTree: leaf(paneId, { kind: "diff", path, staged }),
      activeLeafId: paneId,
      paneOrder: [paneId],
    };
    set((state) => ({ tabs: [...state.tabs, tab], activeId: id }));
    return id;
  },

  openFromSidebar: (content, title) => {
    const spaceId = get().ensureSpace();
    // Checked separately from the discriminated narrowing below: TypeScript
    // can't carry `content.kind === "terminal" && content.ssh` through a
    // boolean variable, so the two later branches that only need a yes/no
    // (not `content.ssh.connectionId` itself) read this flag instead of
    // re-narrowing `content` each time.
    const isFreshSsh = content.kind === "terminal" && !!content.ssh;

    if (content.kind === "terminal" && content.ssh) {
      if (sshAlreadyOpen(get().tabs, spaceId, content.ssh.connectionId)) {
        return { status: "already-connected" };
      }
    }

    const resolvedTitle =
      title ?? (content.kind === "editor" ? basename(content.path) : "Untitled");
    const activeTab = get().tabs.find((t) => t.id === get().activeId);

    if (!activeTab || activeTab.kind === "launcher") {
      const id = nextTabId();
      const paneId = nextPaneId();
      if (isFreshSsh) {
        markFreshSshLeaf(paneId);
      }
      const tab: Tab = {
        id,
        spaceId,
        kind: content.kind,
        title: resolvedTitle,
        paneTree: leaf(paneId, content),
        activeLeafId: paneId,
        paneOrder: [paneId],
        ...(isFreshSsh ? { renamed: true } : {}),
      };
      set((state) => ({ tabs: [...state.tabs, tab], activeId: id }));
      if (activeTab) {
        get().closeTab(activeTab.id);
      }
      return { status: "opened" };
    }

    if (activeTab.paneOrder.length >= 8) {
      return { status: "at-capacity" };
    }

    const newId = nextPaneId();
    if (isFreshSsh) {
      markFreshSshLeaf(newId);
    }
    const panes: OrderedPane[] = [
      ...activeTab.paneOrder.map((id) => ({
        id,
        content: findPaneContent(activeTab.paneTree, id)!,
      })),
      { id: newId, content },
    ];
    const paneTree = gridLayout(panes);
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === activeTab.id
          ? { ...t, paneTree, paneOrder: [...activeTab.paneOrder, newId], activeLeafId: newId }
          : t,
      ),
    }));
    return { status: "opened" };
  },

  openInNewTab: (content, title) => {
    const spaceId = get().ensureSpace();
    const isFreshSsh = content.kind === "terminal" && !!content.ssh;

    if (content.kind === "terminal" && content.ssh) {
      if (sshAlreadyOpen(get().tabs, spaceId, content.ssh.connectionId)) {
        return { status: "already-connected" };
      }
    }

    const resolvedTitle =
      title ?? (content.kind === "editor" ? basename(content.path) : "Untitled");
    const id = nextTabId();
    const paneId = nextPaneId();
    if (isFreshSsh) {
      markFreshSshLeaf(paneId);
    }
    const tab: Tab = {
      id,
      spaceId,
      kind: content.kind,
      title: resolvedTitle,
      paneTree: leaf(paneId, content),
      activeLeafId: paneId,
      paneOrder: [paneId],
      ...(isFreshSsh ? { renamed: true } : {}),
    };
    set((state) => ({ tabs: [...state.tabs, tab], activeId: id }));
    return { status: "opened" };
  },

  openHtmlPreview: (tabId, fromLeafId, filePath) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab) {
      return;
    }
    const url = fileUrl(filePath);
    const title = basename(filePath) || "preview";
    const target = decideHtmlPreviewOpen(tab.paneTree, fromLeafId);

    if (target.kind === "replace") {
      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === tabId
            ? {
                ...t,
                paneTree: setLeafPane(t.paneTree, target.leafId, { kind: "preview", url }),
                activeLeafId: target.leafId,
              }
            : t,
        ),
      }));
      return;
    }

    if (target.kind === "split") {
      get().splitPaneWith(tabId, target.fromLeafId, { kind: "preview", url }, "row");
      return;
    }

    // previewTab: open or reuse the single preview tab in this tab's space.
    const spaceId = tab.spaceId;
    const existing = get().tabs.find((t) => t.kind === "preview" && t.spaceId === spaceId);
    if (existing) {
      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === existing.id
            ? {
                ...t,
                title,
                paneTree: setLeafPane(existing.paneTree, existing.activeLeafId, { kind: "preview", url }),
              }
            : t,
        ),
        activeId: existing.id,
      }));
      return;
    }
    const id = nextTabId();
    const paneId = nextPaneId();
    const newTab: Tab = {
      id,
      spaceId,
      kind: "preview",
      title,
      paneTree: leaf(paneId, { kind: "preview", url }),
      activeLeafId: paneId,
      paneOrder: [paneId],
    };
    set((state) => ({ tabs: [...state.tabs, newTab], activeId: id }));
  },

  setTabTitle: (id, title) =>
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === id ? { ...t, title, renamed: true } : t)),
    })),

  syncTabTitleToCwd: (id, cwd) =>
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === id && t.kind === "terminal" && !t.renamed
          ? { ...t, title: basename(cwd) }
          : t,
      ),
    })),

  closeTab: (id) =>
    set((state) => {
      const closing = state.tabs.find((t) => t.id === id);
      if (!closing) {
        return state;
      }
      const sameSpace = state.tabs.filter((t) => t.spaceId === closing.spaceId);
      const indexInSpace = sameSpace.findIndex((t) => t.id === id);
      const tabs = state.tabs.filter((t) => t.id !== id);
      let activeId = state.activeId;
      if (state.activeId === id) {
        const remaining = sameSpace.filter((t) => t.id !== id);
        activeId = neighbourId(remaining, indexInSpace);
      }
      return { tabs, activeId };
    }),

  closePaneOrTab: () => {
    const state = get();
    const tab = state.tabs.find((t) => t.id === state.activeId);
    if (!tab) {
      return;
    }
    const panes = computeLayout(tab.paneTree);
    if (panes.length <= 1) {
      get().closeTab(tab.id);
      return;
    }
    // Bottom-most wins; ties broken by right-most — so a split peels away from
    // the bottom-right corner, the reverse of how panes are read.
    const target = panes.reduce((a, b) => {
      if (b.rect.top !== a.rect.top) {
        return b.rect.top > a.rect.top ? b : a;
      }
      return b.rect.left > a.rect.left ? b : a;
    });
    get().closePane(tab.id, target.id);
  },

  setActive: (id) =>
    set((state) => {
      const tab = state.tabs.find((t) => t.id === id);
      return tab ? { activeId: id, activeSpaceId: tab.spaceId } : { activeId: id };
    }),

  reorderTab: (activeId, overId) =>
    set((state) => {
      if (activeId === overId) {
        return state;
      }
      const moving = state.tabs.find((t) => t.id === activeId);
      const over = state.tabs.find((t) => t.id === overId);
      if (!moving || !over || moving.spaceId !== over.spaceId) {
        return state;
      }
      // Slots are the indices this space's tabs occupy in the flat array;
      // we reorder only the subsequence and write it back into those slots,
      // so tabs from other spaces never move.
      const slots: number[] = [];
      state.tabs.forEach((tab, index) => {
        if (tab.spaceId === moving.spaceId) {
          slots.push(index);
        }
      });
      const subsequence = slots.map((index) => state.tabs[index]);
      const from = subsequence.findIndex((t) => t.id === activeId);
      const to = subsequence.findIndex((t) => t.id === overId);
      const reordered = moveItem(subsequence, from, to);
      const tabs = state.tabs.slice();
      slots.forEach((slotIndex, k) => {
        tabs[slotIndex] = reordered[k];
      });
      return { tabs };
    }),

  splitActivePane: (direction) =>
    set((state) => {
      const tab = state.tabs.find((t) => t.id === state.activeId);
      if (!tab || tab.paneOrder.length >= 8) {
        return state;
      }
      const newId = nextPaneId();
      return {
        tabs: state.tabs.map((t) =>
          t.id === tab.id
            ? {
                ...t,
                // A fresh split shows the launcher so the user picks what goes in it.
                // Directional and pane-specific (unlike openFromSidebar's grid rebuild)
                // — the user is choosing exactly which pane to split and which way.
                paneTree: splitLeaf(t.paneTree, t.activeLeafId, direction, newId, {
                  kind: "launcher",
                }),
                activeLeafId: newId,
                paneOrder: [...t.paneOrder, newId],
              }
            : t,
        ),
      };
    }),

  setActiveLeaf: (tabId, leafId) =>
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === tabId ? { ...tab, activeLeafId: leafId } : tab,
      ),
    })),

  focusNextPane: () =>
    set((state) => {
      const tab = state.tabs.find((t) => t.id === state.activeId);
      if (!tab) {
        return state;
      }
      // Walk the leaves in their reading order; a single-pane tab has nothing
      // to cycle to.
      const ids = leafIds(tab.paneTree);
      if (ids.length <= 1) {
        return state;
      }
      const current = ids.indexOf(tab.activeLeafId);
      const next = ids[(current + 1) % ids.length];
      return {
        tabs: state.tabs.map((t) =>
          t.id === tab.id ? { ...t, activeLeafId: next } : t,
        ),
      };
    }),

  resizePane: (tabId, splitId, sizes) =>
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === tabId
          ? { ...tab, paneTree: setSizesById(tab.paneTree, splitId, sizes) }
          : tab,
      ),
    })),

  splitPaneWith: (tabId, fromLeafId, content, direction, anchor = "after") => {
    const newId = nextPaneId();
    set((state) => ({
      tabs: state.tabs.map((tab) => {
        if (tab.id !== tabId) {
          return tab;
        }
        return {
          ...tab,
          paneTree: splitLeaf(tab.paneTree, fromLeafId, direction, newId, content, anchor),
          activeLeafId: newId,
          paneOrder: [...tab.paneOrder, newId],
        };
      }),
    }));
    return newId;
  },

  wrapPaneWith: (tabId, content, direction, anchor) => {
    const newId = nextPaneId();
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === tabId
          ? {
              ...tab,
              paneTree: wrapTree(tab.paneTree, newId, content, direction, anchor),
              activeLeafId: newId,
              paneOrder: [...tab.paneOrder, newId],
            }
          : tab,
      ),
    }));
    return newId;
  },

  setPreviewTabTitle: (tabId, leafId, title) =>
    set((state) => {
      const trimmed = title.trim();
      const tab = state.tabs.find((t) => t.id === tabId);
      if (!tab || trimmed === "" || tab.title === trimmed) {
        return state;
      }
      const current = findPaneContent(tab.paneTree, leafId);
      if (!current || current.kind !== "preview") {
        return state;
      }
      // The tab title follows the previewed page only when the preview fills the
      // whole tab and the user hasn't given it a name of their own.
      const isWholeTab = leafIds(tab.paneTree).length === 1;
      if (!isWholeTab || tab.renamed) {
        return state;
      }
      return {
        tabs: state.tabs.map((t) => (t.id === tabId ? { ...t, title: trimmed } : t)),
      };
    }),

  setPaneContent: (tabId, leafId, content) =>
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === tabId
          ? { ...tab, paneTree: setLeafPane(tab.paneTree, leafId, content) }
          : tab,
      ),
    })),

  navigatePreview: (tabId, leafId, url) =>
    set((state) => {
      const tab = state.tabs.find((t) => t.id === tabId);
      if (!tab) {
        return state;
      }
      const current = findPaneContent(tab.paneTree, leafId);
      // Only preview panes navigate; skip a no-op write so persistence is not
      // churned when the url hasn't actually changed.
      if (!current || current.kind !== "preview" || current.url === url) {
        return state;
      }
      // The tab title follows the previewed site only when the preview fills the
      // whole tab and the user hasn't given it a name of their own. In a split,
      // the title belongs to the tab as a whole, not to one preview pane.
      const isWholeTab = leafIds(tab.paneTree).length === 1;
      const retitle = isWholeTab && !tab.renamed;
      return {
        tabs: state.tabs.map((t) =>
          t.id === tabId
            ? {
                ...t,
                title: retitle ? previewTitle(url) : t.title,
                paneTree: setLeafPane(t.paneTree, leafId, { kind: "preview", url }),
              }
            : t,
        ),
      };
    }),

  setTerminalCwd: (tabId, leafId, cwd) =>
    set((state) => {
      const tab = state.tabs.find((t) => t.id === tabId);
      if (!tab) {
        return state;
      }
      const current = findPaneContent(tab.paneTree, leafId);
      // Only terminal panes carry a cwd; skip a no-op write so persistence is
      // not churned on every snapshot.
      if (!current || current.kind !== "terminal" || current.cwd === cwd) {
        return state;
      }
      return {
        tabs: state.tabs.map((t) =>
          t.id === tabId
            ? {
                ...t,
                paneTree: setLeafPane(t.paneTree, leafId, {
                  kind: "terminal",
                  cwd,
                  ssh: current.ssh,
                }),
              }
            : t,
        ),
      };
    }),

  closePane: (tabId, leafId) =>
    set((state) => {
      const tab = state.tabs.find((t) => t.id === tabId);
      if (!tab) {
        return state;
      }
      const paneTree = removeLeaf(tab.paneTree, leafId);
      if (!paneTree) {
        const sameSpace = state.tabs.filter((t) => t.spaceId === tab.spaceId);
        const indexInSpace = sameSpace.findIndex((t) => t.id === tabId);
        const tabs = state.tabs.filter((t) => t.id !== tabId);
        let activeId = state.activeId;
        if (state.activeId === tabId) {
          const remaining = sameSpace.filter((t) => t.id !== tabId);
          activeId = neighbourId(remaining, indexInSpace);
        }
        return { tabs, activeId };
      }
      // When the focused pane is the one closing, move focus to the first
      // remaining pane.
      const remaining = leafIds(paneTree);
      const activeLeafId =
        tab.activeLeafId === leafId ? (remaining[0] ?? tab.activeLeafId) : tab.activeLeafId;
      return {
        tabs: state.tabs.map((t) =>
          t.id === tabId
            ? { ...t, paneTree, activeLeafId, paneOrder: t.paneOrder.filter((id) => id !== leafId) }
            : t,
        ),
      };
    }),
    }),
    {
      name: TABS_STORAGE_KEY,
      storage: createJSONStorage(() => perWindowStorage()),
      version: 2,
      migrate: migratePersistedTabs,
      partialize: (state) => ({
        spaces: state.spaces,
        activeSpaceId: state.activeSpaceId,
        tabs: state.tabs,
        activeId: state.activeId,
      }),
    },
  ),
);
