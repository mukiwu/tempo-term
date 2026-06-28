import { lazy, Suspense, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, X } from "lucide-react";
import { TerminalView } from "./TerminalView";
import { dropPathsIntoTerminal, writeToTerminal } from "./lib/terminalBus";
import {
  computeLayout,
  computeSplitters,
  resolveTerminalCwd,
  type PaneContent,
  type SplitterInfo,
} from "./lib/terminalLayout";
// Heavy, non-terminal pane content is code-split so it stays out of the startup
// bundle (TipTap + lowlight, CodeMirror, the git graph). It loads the first time
// such a pane is shown. The terminal and launcher stay eager — a terminal is
// usually the first pane painted on launch.
const EditorTabContent = lazy(() =>
  import("@/modules/editor/EditorTabContent").then((m) => ({ default: m.EditorTabContent })),
);
const NoteTabContent = lazy(() =>
  import("@/modules/notes/NoteTabContent").then((m) => ({ default: m.NoteTabContent })),
);
const PreviewTabContent = lazy(() =>
  import("@/modules/preview/PreviewTabContent").then((m) => ({ default: m.PreviewTabContent })),
);
const GitGraphTabContent = lazy(() =>
  import("@/modules/git-graph/GitGraphTabContent").then((m) => ({
    default: m.GitGraphTabContent,
  })),
);
const LogTabContent = lazy(() =>
  import("@/modules/logs/LogTabContent").then((m) => ({ default: m.LogTabContent })),
);
import { LauncherPanel } from "@/components/LauncherPanel";
import { dropOverlayClassName } from "@/components/EntryDropOverlay";
import {
  fileUrl,
  shellQuotePath,
  useEntryDragStore,
  type DraggedEntry,
} from "@/modules/explorer/lib/dragEntry";
import { insertLinkIntoNote } from "@/modules/notes/lib/noteBus";
import { deleteTerminalHistory } from "./lib/terminalHistory";
import { useTabsStore, type Tab } from "@/stores/tabsStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useRemoteExplorerRoot } from "@/modules/ssh/lib/useRemoteExplorerRoot";

const MIN_FRACTION = 0.1;
const MAX_FRACTION = 0.9;

/**
 * Renders one tab as a recursive split of panes. Each leaf shows a terminal,
 * editor, note, preview, or git graph, and the toolbar splits the active pane
 * into any of those. Works for every tab kind, not just terminals.
 */
export function PaneTabContent({ tab }: { tab: Tab }) {
  const { t } = useTranslation();
  const setActiveLeaf = useTabsStore((s) => s.setActiveLeaf);
  const resizePane = useTabsStore((s) => s.resizePane);
  const splitPaneWith = useTabsStore((s) => s.splitPaneWith);
  const setPaneContent = useTabsStore((s) => s.setPaneContent);
  const setTerminalCwd = useTabsStore((s) => s.setTerminalCwd);
  const closePane = useTabsStore((s) => s.closePane);
  const isActiveTab = useTabsStore((s) => s.activeId === tab.id);
  const paneAreaRef = useRef<HTMLDivElement>(null);
  // Which splitter is currently being dragged, so its hairline keeps its
  // highlight color even when the pointer slips off the thin hit area mid-drag.
  const [draggingSplitterId, setDraggingSplitterId] = useState<string | null>(null);
  // Which splitter the pointer is hovering. Tracked in state (not CSS
  // group-hover) because the hairline lives in a child element and group-hover
  // doesn't reach it reliably in the app's WebView.
  const [hoveredSplitterId, setHoveredSplitterId] = useState<string | null>(null);
  // Pointer-drag state lives in the explorer drag store (see dragEntry.ts): the
  // entry being dragged, which pane it's over, and a resolved drop to consume.
  const dragging = useEntryDragStore((s) => s.dragging);
  const draggedEntry = useEntryDragStore((s) => s.entry);
  const hoverLeaf = useEntryDragStore((s) => s.hoverLeafId);
  const pendingDrop = useEntryDragStore((s) => s.pendingDrop);
  // New terminal panes (incl. splits) start in the explorer's current dir, not
  // the tab's original cwd — so a split follows where you've navigated to.
  const rootPath = useWorkspaceStore((s) => s.rootPath);

  const panes = computeLayout(tab.paneTree);
  const splitters = computeSplitters(tab.paneTree);
  const multiple = panes.length > 1;

  // When this tab's active pane is an SSH terminal, point the file explorer at
  // that host's remote files. A local (or non-active) pane yields null, so the
  // existing local cwd tracking keeps driving the root.
  const activeLeaf = panes.find((p) => p.id === tab.activeLeafId);
  const activeSshConnectionId =
    isActiveTab && activeLeaf?.content.kind === "terminal" && activeLeaf.content.ssh
      ? activeLeaf.content.ssh.connectionId
      : null;
  useRemoteExplorerRoot(activeSshConnectionId);
  // The splitter currently being dragged, used to drive the drag overlay's
  // resize cursor (see the overlay below).
  const draggingSplitter = draggingSplitterId
    ? splitters.find((s) => s.id === draggingSplitterId)
    : undefined;

  // Single-file panes reject folders; terminal/note take both. Dropping a file
  // onto a launcher pane opens it, so a launcher accepts a file too.
  function canDrop(content: PaneContent, entry: DraggedEntry): boolean {
    if (
      content.kind === "editor" ||
      content.kind === "preview" ||
      content.kind === "launcher"
    ) {
      return !entry.isDir;
    }
    return true;
  }

  function handleDrop(content: PaneContent, leafId: string, entry: DraggedEntry) {
    switch (content.kind) {
      case "terminal":
        setActiveLeaf(tab.id, leafId);
        if (!dropPathsIntoTerminal(leafId, [entry.path])) {
          writeToTerminal(leafId, `${shellQuotePath(entry.path)} `);
        }
        break;
      case "editor":
        if (!entry.isDir) {
          setPaneContent(tab.id, leafId, { kind: "editor", path: entry.path });
        }
        break;
      case "note":
        insertLinkIntoNote(content.noteId, entry.name, entry.path);
        break;
      case "preview":
        if (!entry.isDir) {
          setPaneContent(tab.id, leafId, { kind: "preview", url: fileUrl(entry.path) });
        }
        break;
      case "launcher":
        // Drop a file onto a freshly split pane to open it right there.
        if (!entry.isDir) {
          setPaneContent(tab.id, leafId, { kind: "editor", path: entry.path });
        }
        break;
      case "log":
        // Log panes are read-only; drops are ignored.
        break;
    }
  }

  const panesRef = useRef(panes);
  panesRef.current = panes;
  const handleDropRef = useRef(handleDrop);
  handleDropRef.current = handleDrop;
  const canDropRef = useRef(canDrop);
  canDropRef.current = canDrop;

  // A pointer drag resolves its drop target into the store; the tab that owns
  // that pane runs the drop and clears it. Other tabs ignore it (pane not found).
  useEffect(() => {
    if (!pendingDrop) {
      return;
    }
    const pane = panesRef.current.find((p) => p.id === pendingDrop.leafId);
    if (!pane) {
      return;
    }
    if (canDropRef.current(pane.content, pendingDrop.entry)) {
      handleDropRef.current(pane.content, pendingDrop.leafId, pendingDrop.entry);
    }
    useEntryDragStore.getState().clearPendingDrop();
  }, [pendingDrop]);

  function startDrag(e: ReactMouseEvent, splitter: SplitterInfo) {
    e.preventDefault();
    e.stopPropagation();
    const container = paneAreaRef.current;
    if (!container) {
      return;
    }
    const isRow = splitter.direction === "row";
    // The split's own area stays fixed while only its ratio changes, so the
    // snapshot rect captured here keeps the maths correct through the drag.
    const span = isRow ? splitter.rect.width : splitter.rect.height;
    const start = isRow ? splitter.rect.left : splitter.rect.top;

    document.body.style.cursor = isRow ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
    setDraggingSplitterId(splitter.id);

    function onMove(ev: MouseEvent) {
      const box = container!.getBoundingClientRect();
      const pct = isRow
        ? ((ev.clientX - box.left) / box.width) * 100
        : ((ev.clientY - box.top) / box.height) * 100;
      let fraction = span > 0 ? (pct - start) / span : 0.5;
      fraction = Math.min(MAX_FRACTION, Math.max(MIN_FRACTION, fraction));
      resizePane(tab.id, splitter.id, [fraction, 1 - fraction]);
    }
    function onUp() {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setDraggingSplitterId(null);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  return (
    <div className="flex h-full flex-col bg-bg-inset">
      <div ref={paneAreaRef} className="relative min-h-0 flex-1">
        {panes.map((pane) => {
          const active = pane.id === tab.activeLeafId;
          const dropOk = draggedEntry ? canDrop(pane.content, draggedEntry) : false;
          return (
            <div
              key={pane.id}
              data-pane-leaf={pane.id}
              onMouseDown={() => setActiveLeaf(tab.id, pane.id)}
              style={{
                position: "absolute",
                left: `${pane.rect.left}%`,
                top: `${pane.rect.top}%`,
                width: `${pane.rect.width}%`,
                height: `${pane.rect.height}%`,
              }}
              className={`p-1 ${
                multiple ? (active ? "border border-accent/40" : "border border-border") : ""
              }`}
            >
              {multiple && (
                <button
                  type="button"
                  aria-label={t("workspace.closePane")}
                  title={t("workspace.closePane")}
                  onClick={(e) => {
                    e.stopPropagation();
                    void deleteTerminalHistory(pane.id);
                    closePane(tab.id, pane.id);
                  }}
                  className="absolute right-1.5 top-1.5 z-10 rounded bg-bg-inset/80 p-0.5 text-fg-subtle hover:bg-border-strong hover:text-fg"
                >
                  <X size={12} />
                </button>
              )}
              <Suspense
                fallback={
                  <div className="flex h-full w-full items-center justify-center text-fg-subtle">
                    <Loader2 size={16} className="animate-spin" />
                  </div>
                }
              >
                {pane.content.kind === "editor" ? (
                  <EditorTabContent path={pane.content.path} />
                ) : pane.content.kind === "note" ? (
                  <NoteTabContent
                    noteId={pane.content.noteId}
                    tabId={tab.id}
                    leafId={pane.id}
                  />
                ) : pane.content.kind === "preview" ? (
                  <PreviewTabContent url={pane.content.url} />
                ) : pane.content.kind === "git-graph" ? (
                  <GitGraphTabContent />
                ) : pane.content.kind === "log" ? (
                  <LogTabContent logName={pane.content.logName} />
                ) : pane.content.kind === "launcher" ? (
                  <LauncherPanel
                    target={{ mode: "replacePane", tabId: tab.id, leafId: pane.id }}
                  />
                ) : (
                  <TerminalView
                    active={active}
                    cwdTracking={
                      active &&
                      isActiveTab &&
                      // SSH panes have no cwd; skip cwd tracking for them.
                      (pane.content.kind !== "terminal" || !pane.content.ssh)
                    }
                    cwd={resolveTerminalCwd(
                      pane.content.kind === "terminal" ? pane.content.cwd : undefined,
                      rootPath,
                      tab.cwd,
                    )}
                    ssh={pane.content.kind === "terminal" ? pane.content.ssh : undefined}
                    leafId={pane.id}
                    onExit={() => closePane(tab.id, pane.id)}
                    onCwdChange={(dir) => setTerminalCwd(tab.id, pane.id, dir)}
                    onOpenFile={(absolutePath) =>
                      splitPaneWith(tab.id, pane.id, { kind: "editor", path: absolutePath }, "row")
                    }
                    onOpenPreview={(url) =>
                      splitPaneWith(tab.id, pane.id, { kind: "preview", url }, "row")
                    }
                  />
                )}
              </Suspense>

              {/* Highlight only the pane under the cursor while dragging an
                  explorer entry. The drop itself is handled by the document-level
                  drag/dragend listeners above, since WKWebView swallows the
                  webview's own HTML5 drop events when dragDropEnabled is on. */}
              {dragging && pane.id === hoverLeaf && (
                <div className={dropOverlayClassName(dropOk)} />
              )}
            </div>
          );
        })}

        {/* Draggable dividers, one per split, sitting on the pane borders */}
        {splitters.map((splitter) => {
          const isRow = splitter.direction === "row";
          const dividerPct = isRow
            ? splitter.rect.left + splitter.rect.width * splitter.fraction
            : splitter.rect.top + splitter.rect.height * splitter.fraction;
          const isLit =
            draggingSplitterId === splitter.id || hoveredSplitterId === splitter.id;
          return (
            <div
              key={splitter.id}
              onMouseDown={(e) => startDrag(e, splitter)}
              onMouseEnter={() => setHoveredSplitterId(splitter.id)}
              onMouseLeave={() => setHoveredSplitterId(null)}
              style={
                isRow
                  ? {
                      position: "absolute",
                      left: `${dividerPct}%`,
                      top: `${splitter.rect.top}%`,
                      height: `${splitter.rect.height}%`,
                      width: 8,
                      transform: "translateX(-50%)",
                    }
                  : {
                      position: "absolute",
                      top: `${dividerPct}%`,
                      left: `${splitter.rect.left}%`,
                      width: `${splitter.rect.width}%`,
                      height: 8,
                      transform: "translateY(-50%)",
                    }
              }
              className={`z-20 ${
                isRow ? "cursor-col-resize" : "cursor-row-resize"
              }`}
            >
              {/*
               * The hit area stays 8px so the divider is easy to grab, but only
               * this centered 1px hairline is visible. Hover / drag just recolors
               * the hairline instead of flooding the whole strip, so the divider
               * never looks like it got thicker.
               */}
              <div
                className={`pointer-events-none absolute transition-colors ${
                  isLit ? "bg-accent" : "bg-transparent"
                } ${
                  isRow
                    ? "inset-y-0 left-1/2 w-px -translate-x-1/2"
                    : "inset-x-0 top-1/2 h-px -translate-y-1/2"
                }`}
              />
            </div>
          );
        })}

        {/* While a divider is dragged, a transparent overlay sits above every
            pane so the pointer can't slip into a preview iframe (or any other
            embedded document) and swallow the mouseup — which leaves the drag
            stuck to the cursor. Keeping the pointer in this document also makes
            the resize track smoothly instead of stalling over the iframe. */}
        {draggingSplitterId && (
          <div
            data-testid="pane-drag-overlay"
            className={`absolute inset-0 z-30 ${
              draggingSplitter?.direction === "row"
                ? "cursor-col-resize"
                : "cursor-row-resize"
            }`}
          />
        )}
      </div>
    </div>
  );
}
