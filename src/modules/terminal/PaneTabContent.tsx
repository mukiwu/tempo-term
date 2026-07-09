import { lazy, Suspense, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, X } from "lucide-react";
import { TerminalView } from "./TerminalView";
import { dropPathsIntoTerminal, writeToTerminal } from "./lib/terminalBus";
import {
  computeLayout,
  computeSplitters,
  resolveDropZone,
  resolveTerminalCwd,
  type DropZone,
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
const DiffTabContent = lazy(() =>
  import("@/modules/diff/DiffTabContent").then((m) => ({ default: m.DiffTabContent })),
);
const SessionsTabContent = lazy(() =>
  import("@/modules/sessions/SessionsTabContent").then((m) => ({
    default: m.SessionsTabContent,
  })),
);
import { LauncherPanel } from "@/components/LauncherPanel";
import { dropOverlayClassName, outerBandOverlayClassName } from "@/components/EntryDropOverlay";
import { InfoDialog } from "@/components/InfoDialog";
import { Tooltip } from "@/components/Tooltip";
import {
  fileUrl,
  shellQuotePath,
  useEntryDragStore,
  type DraggedEntry,
} from "@/modules/explorer/lib/dragEntry";
import { insertLinkIntoNote } from "@/modules/notes/lib/noteBus";
import { useNoteDragStore } from "@/modules/notes/lib/noteDrag";
import { useSshDragStore } from "@/modules/ssh/lib/sshDrag";
import { deleteTerminalHistory } from "./lib/terminalHistory";
import { sshAlreadyOpen, useTabsStore, type Tab } from "@/stores/tabsStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useUiStore, selectAnyOverlayOpen } from "@/stores/uiStore";
import { shouldShowPreview } from "@/modules/preview/lib/previewWebview";
import { useRemoteExplorerRoot } from "@/modules/ssh/lib/useRemoteExplorerRoot";
import { useOsc7FallbackHint } from "@/modules/ssh/lib/useOsc7FallbackHint";

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
  const wrapPaneWith = useTabsStore((s) => s.wrapPaneWith);
  const setPaneContent = useTabsStore((s) => s.setPaneContent);
  const navigatePreview = useTabsStore((s) => s.navigatePreview);
  const setPreviewTabTitle = useTabsStore((s) => s.setPreviewTabTitle);
  const setTerminalCwd = useTabsStore((s) => s.setTerminalCwd);
  const closePane = useTabsStore((s) => s.closePane);
  const openHtmlPreview = useTabsStore((s) => s.openHtmlPreview);
  const isActiveTab = useTabsStore((s) => s.activeId === tab.id);
  const anyOverlay = useUiStore(selectAnyOverlayOpen);
  const paneAreaRef = useRef<HTMLDivElement>(null);
  // Which splitter is currently being dragged, so its hairline keeps its
  // highlight color even when the pointer slips off the thin hit area mid-drag.
  const [draggingSplitterId, setDraggingSplitterId] = useState<string | null>(null);
  // Which splitter the pointer is hovering. Tracked in state (not CSS
  // group-hover) because the hairline lives in a child element and group-hover
  // doesn't reach it reliably in the app's WebView.
  const [hoveredSplitterId, setHoveredSplitterId] = useState<string | null>(null);
  // Whether a file drop attempted a split while the tab was already at its
  // 8-pane cap, so the at-capacity dialog shows instead.
  const [atCapacity, setAtCapacity] = useState(false);
  const rootDirection = tab.paneTree.kind === "split" ? tab.paneTree.direction : null;
  // Pointer-drag state lives in the explorer drag store (see dragEntry.ts): the
  // entry being dragged, which pane it's over, and a resolved drop to consume.
  const dragging = useEntryDragStore((s) => s.dragging);
  const draggedEntry = useEntryDragStore((s) => s.entry);
  const hoverLeaf = useEntryDragStore((s) => s.hoverLeafId);
  const hoverPointerPct = useEntryDragStore((s) => s.hoverPointerPct);
  const pendingDrop = useEntryDragStore((s) => s.pendingDrop);
  const pendingNotePaneDrop = useNoteDragStore((s) => s.pendingPaneDrop);
  const notePaneHover = useNoteDragStore((s) => s.paneHover);
  const pendingSshPaneDrop = useSshDragStore((s) => s.pendingPaneDrop);
  const sshPaneHover = useSshDragStore((s) => s.paneHover);
  // Whether a dragged-in SSH connection is already open elsewhere in this
  // space, so the drop gets blocked and this dialog explains why. The
  // connection's name is cached alongside the flag because pendingSshPaneDrop
  // is cleared (and its name with it) as soon as the drop is resolved.
  const [sshAlreadyConnected, setSshAlreadyConnected] = useState(false);
  const [sshAlreadyConnectedName, setSshAlreadyConnectedName] = useState("");
  // New terminal panes (incl. splits) start in the explorer's current dir, not
  // the tab's original cwd — so a split follows where you've navigated to.
  const rootPath = useWorkspaceStore((s) => s.rootPath);

  const panes = computeLayout(tab.paneTree);
  const splitters = computeSplitters(tab.paneTree);
  const multiple = panes.length > 1;

  const hoverZone: DropZone | null =
    hoverLeaf && hoverPointerPct
      ? resolveDropZone({
          paneRect: panes.find((p) => p.id === hoverLeaf)?.rect ?? { left: 0, top: 0, width: 100, height: 100 },
          rootDirection,
          pointerXPct: hoverPointerPct.xPct,
          pointerYPct: hoverPointerPct.yPct,
          isFolder: draggedEntry?.isDir ?? false,
        })
      : notePaneHover
        ? resolveDropZone({
            paneRect: panes.find((p) => p.id === notePaneHover.leafId)?.rect ?? { left: 0, top: 0, width: 100, height: 100 },
            rootDirection,
            pointerXPct: notePaneHover.xPct,
            pointerYPct: notePaneHover.yPct,
            isFolder: false,
          })
        : sshPaneHover
          ? resolveDropZone({
              paneRect: panes.find((p) => p.id === sshPaneHover.leafId)?.rect ?? { left: 0, top: 0, width: 100, height: 100 },
              rootDirection,
              pointerXPct: sshPaneHover.xPct,
              pointerYPct: sshPaneHover.yPct,
              isFolder: false,
            })
          : null;
  const activeHoverLeaf = hoverLeaf ?? notePaneHover?.leafId ?? sshPaneHover?.leafId ?? null;
  const anyDragging = dragging || notePaneHover !== null || sshPaneHover !== null;

  // When this tab's active pane is an SSH terminal, point the file explorer at
  // that host's remote files. A local (or non-active) pane yields null, so the
  // existing local cwd tracking keeps driving the root.
  const activeLeaf = panes.find((p) => p.id === tab.activeLeafId);
  const activeSshConnectionId =
    isActiveTab && activeLeaf?.content.kind === "terminal" && activeLeaf.content.ssh
      ? activeLeaf.content.ssh.connectionId
      : null;
  useRemoteExplorerRoot(activeSshConnectionId);
  const { hintConnectionId, dismissHint } = useOsc7FallbackHint(activeSshConnectionId);
  // The splitter currently being dragged, used to drive the drag overlay's
  // resize cursor (see the overlay below).
  const draggingSplitter = draggingSplitterId
    ? splitters.find((s) => s.id === draggingSplitterId)
    : undefined;

  // Single-file panes reject folders; terminal/note take both. Dropping a file
  // onto a launcher pane opens it, so a launcher accepts a file too. A diff or
  // sessions pane is a read-only browser with no drop action, so it accepts
  // nothing.
  function canDrop(content: PaneContent, entry: DraggedEntry): boolean {
    if (content.kind === "diff" || content.kind === "sessions") {
      return false;
    }
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
  // The drop position decides center (per-kind replace, unchanged) vs. an
  // edge/outer zone (split the pane, or wrap the whole tree, with a new
  // editor pane) — see terminalLayout.ts's resolveDropZone.
  useEffect(() => {
    if (!pendingDrop) {
      return;
    }
    const pane = panesRef.current.find((p) => p.id === pendingDrop.leafId);
    if (!pane) {
      return;
    }
    const zone = resolveDropZone({
      paneRect: pane.rect,
      rootDirection,
      pointerXPct: pendingDrop.xPct,
      pointerYPct: pendingDrop.yPct,
      isFolder: pendingDrop.entry.isDir,
    });
    if (zone.kind === "center") {
      if (canDropRef.current(pane.content, pendingDrop.entry)) {
        handleDropRef.current(pane.content, pendingDrop.leafId, pendingDrop.entry);
      }
      useEntryDragStore.getState().clearPendingDrop();
      return;
    }
    if (pendingDrop.entry.isDir) {
      // Folder exception: edge/outer zones never apply to folders, so this
      // should already be unreachable (resolveDropZone always returns center
      // for isFolder), but guard defensively rather than split on a folder.
      useEntryDragStore.getState().clearPendingDrop();
      return;
    }
    if (tab.paneOrder.length >= 8) {
      setAtCapacity(true);
      useEntryDragStore.getState().clearPendingDrop();
      return;
    }
    const newContent: PaneContent = { kind: "editor", path: pendingDrop.entry.path };
    if (zone.scope === "individual") {
      splitPaneWith(tab.id, pendingDrop.leafId, newContent, zone.direction, zone.anchor);
    } else {
      wrapPaneWith(tab.id, newContent, zone.direction, zone.anchor);
    }
    useEntryDragStore.getState().clearPendingDrop();
  }, [pendingDrop, rootDirection, tab.id, tab.paneOrder.length]);

  // Parallel to the file-drop effect above, but for notes dragged out of the
  // Notes sidebar: there's no per-target-kind center behavior for notes, so
  // center always just replaces the pane's content with the note.
  useEffect(() => {
    if (!pendingNotePaneDrop) {
      return;
    }
    const pane = panesRef.current.find((p) => p.id === pendingNotePaneDrop.leafId);
    if (!pane) {
      return;
    }
    const zone = resolveDropZone({
      paneRect: pane.rect,
      rootDirection,
      pointerXPct: pendingNotePaneDrop.xPct,
      pointerYPct: pendingNotePaneDrop.yPct,
      isFolder: false,
    });
    const newContent: PaneContent = { kind: "note", noteId: pendingNotePaneDrop.noteId };
    if (zone.kind === "center") {
      setPaneContent(tab.id, pendingNotePaneDrop.leafId, newContent);
      useNoteDragStore.getState().clearPendingPaneDrop();
      return;
    }
    if (tab.paneOrder.length >= 8) {
      setAtCapacity(true);
      useNoteDragStore.getState().clearPendingPaneDrop();
      return;
    }
    if (zone.scope === "individual") {
      splitPaneWith(tab.id, pendingNotePaneDrop.leafId, newContent, zone.direction, zone.anchor);
    } else {
      wrapPaneWith(tab.id, newContent, zone.direction, zone.anchor);
    }
    useNoteDragStore.getState().clearPendingPaneDrop();
  }, [pendingNotePaneDrop, rootDirection, tab.id, tab.paneOrder.length]);

  // Parallel to the file/note-drop effects above, but for SSH connections
  // dragged out of the Connections sidebar. Unlike files and notes, a
  // duplicate connection is blocked outright (opening the same connection
  // twice would race for the same forwarded ports) — checked before any zone
  // resolution, so a blocked drop never touches the pane tree at all.
  useEffect(() => {
    if (!pendingSshPaneDrop) {
      return;
    }
    const pane = panesRef.current.find((p) => p.id === pendingSshPaneDrop.leafId);
    if (!pane) {
      return;
    }
    if (sshAlreadyOpen(useTabsStore.getState().tabs, tab.spaceId, pendingSshPaneDrop.connectionId)) {
      setSshAlreadyConnected(true);
      setSshAlreadyConnectedName(pendingSshPaneDrop.connectionName);
      useSshDragStore.getState().clearPendingPaneDrop();
      return;
    }
    const zone = resolveDropZone({
      paneRect: pane.rect,
      rootDirection,
      pointerXPct: pendingSshPaneDrop.xPct,
      pointerYPct: pendingSshPaneDrop.yPct,
      isFolder: false,
    });
    const newContent: PaneContent = {
      kind: "terminal",
      ssh: { connectionId: pendingSshPaneDrop.connectionId },
    };
    if (zone.kind === "center") {
      setPaneContent(tab.id, pendingSshPaneDrop.leafId, newContent);
      useSshDragStore.getState().clearPendingPaneDrop();
      return;
    }
    if (tab.paneOrder.length >= 8) {
      setAtCapacity(true);
      useSshDragStore.getState().clearPendingPaneDrop();
      return;
    }
    if (zone.scope === "individual") {
      splitPaneWith(tab.id, pendingSshPaneDrop.leafId, newContent, zone.direction, zone.anchor);
    } else {
      wrapPaneWith(tab.id, newContent, zone.direction, zone.anchor);
    }
    useSshDragStore.getState().clearPendingPaneDrop();
  }, [pendingSshPaneDrop, rootDirection, tab.id, tab.spaceId, tab.paneOrder.length]);

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
      <div ref={paneAreaRef} data-pane-area className="relative min-h-0 flex-1">
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
                <Tooltip label={t("workspace.closePane")} className="absolute right-1.5 top-1.5 z-10">
                  <button
                    type="button"
                    aria-label={t("workspace.closePane")}
                    onClick={(e) => {
                      e.stopPropagation();
                      void deleteTerminalHistory(pane.id);
                      closePane(tab.id, pane.id);
                    }}
                    className="rounded bg-bg-inset/80 p-0.5 text-fg-subtle hover:bg-border-strong hover:text-fg"
                  >
                    <X size={12} />
                  </button>
                </Tooltip>
              )}
              <Suspense
                fallback={
                  <div className="flex h-full w-full items-center justify-center text-fg-subtle">
                    <Loader2 size={16} className="animate-spin" />
                  </div>
                }
              >
                {pane.content.kind === "editor" ? (
                  (() => {
                    const editorPath = pane.content.path;
                    return (
                      <EditorTabContent
                        path={editorPath}
                        leafId={pane.id}
                        onOpenWebPreview={() =>
                          openHtmlPreview(tab.id, pane.id, editorPath)
                        }
                      />
                    );
                  })()
                ) : pane.content.kind === "note" ? (
                  <NoteTabContent
                    noteId={pane.content.noteId}
                    tabId={tab.id}
                    leafId={pane.id}
                  />
                ) : pane.content.kind === "preview" ? (
                  <PreviewTabContent
                    url={pane.content.url}
                    leafId={pane.id}
                    visible={shouldShowPreview({
                      isActiveTab,
                      dragging: draggingSplitterId !== null,
                      anyOverlay,
                    })}
                    onNavigate={(url) => navigatePreview(tab.id, pane.id, url)}
                    onTitle={(title) => setPreviewTabTitle(tab.id, pane.id, title)}
                  />
                ) : pane.content.kind === "git-graph" ? (
                  <GitGraphTabContent />
                ) : pane.content.kind === "diff" ? (
                  <DiffTabContent path={pane.content.path} staged={pane.content.staged} />
                ) : pane.content.kind === "sessions" ? (
                  <SessionsTabContent />
                ) : pane.content.kind === "launcher" ? (
                  <LauncherPanel
                    target={{ mode: "replacePane", tabId: tab.id, leafId: pane.id }}
                  />
                ) : (
                  <TerminalView
                    active={active}
                    isActiveTab={isActiveTab}
                    cwdTracking={
                      // SSH panes track cwd through OSC 7 reports from the
                      // remote shell instead of the local poll.
                      active && isActiveTab
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
              {anyDragging && pane.id === activeHoverLeaf && (hoverZone === null || hoverZone.kind !== "split" || hoverZone.scope !== "outer") && (
                <div className={dropOverlayClassName(hoverZone, dropOk)} />
              )}
            </div>
          );
        })}

        {anyDragging && hoverZone?.kind === "split" && hoverZone.scope === "outer" && (
          <div className={outerBandOverlayClassName(hoverZone.direction, hoverZone.anchor)} />
        )}

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

      {atCapacity && (
        <InfoDialog
          title={t("workspace.splitRight")}
          message={t("paneCapacityAlert")}
          confirmLabel={t("actions.confirm")}
          onConfirm={() => setAtCapacity(false)}
        />
      )}

      {sshAlreadyConnected && (
        <InfoDialog
          title={t("connectionsPanel.title")}
          message={t("connectionsPanel.alreadyOpenAlert", { name: sshAlreadyConnectedName })}
          confirmLabel={t("actions.confirm")}
          onConfirm={() => setSshAlreadyConnected(false)}
        />
      )}

      {hintConnectionId && (
        <InfoDialog
          title={t("osc7Hint.title")}
          message={t("osc7Hint.message")}
          confirmLabel={t("osc7Hint.confirm")}
          onConfirm={dismissHint}
        />
      )}
    </div>
  );
}
