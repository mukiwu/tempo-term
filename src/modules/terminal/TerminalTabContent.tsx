import { useRef, type MouseEvent as ReactMouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { TerminalView } from "./TerminalView";
import { PaneToolbar } from "./PaneToolbar";
import { computeLayout, computeSplitters, type SplitterInfo } from "./lib/terminalLayout";
import { EditorTabContent } from "@/modules/editor/EditorTabContent";
import { NoteTabContent } from "@/modules/notes/NoteTabContent";
import { PreviewTabContent } from "@/modules/preview/PreviewTabContent";
import { useTabsStore, type TerminalTab } from "@/stores/tabsStore";

const MIN_FRACTION = 0.1;
const MAX_FRACTION = 0.9;

export function TerminalTabContent({ tab }: { tab: TerminalTab }) {
  const { t } = useTranslation();
  const setActiveLeaf = useTabsStore((s) => s.setActiveLeaf);
  const resizePane = useTabsStore((s) => s.resizePane);
  const splitPaneWith = useTabsStore((s) => s.splitPaneWith);
  const closePane = useTabsStore((s) => s.closePane);
  const isActiveTab = useTabsStore((s) => s.activeId === tab.id);
  const paneAreaRef = useRef<HTMLDivElement>(null);

  const panes = computeLayout(tab.paneTree);
  const splitters = computeSplitters(tab.paneTree);
  const multiple = panes.length > 1;

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
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  return (
    <div className="flex h-full flex-col bg-bg-inset">
      <div className="flex h-7 shrink-0 items-center justify-end gap-0.5 border-b border-border px-2">
        <PaneToolbar tabId={tab.id} leafId={tab.activeLeafId} />
      </div>

      <div ref={paneAreaRef} className="relative min-h-0 flex-1">
        {panes.map((pane) => {
          const active = pane.id === tab.activeLeafId;
          return (
            <div
              key={pane.id}
              onMouseDown={() => setActiveLeaf(tab.id, pane.id)}
              style={{
                position: "absolute",
                left: `${pane.rect.left}%`,
                top: `${pane.rect.top}%`,
                width: `${pane.rect.width}%`,
                height: `${pane.rect.height}%`,
              }}
              className={`p-1 ${multiple ? "border border-border" : ""} ${
                active && multiple ? "border-accent" : ""
              }`}
            >
              {multiple && (
                <button
                  type="button"
                  aria-label={t("workspace.closePane")}
                  title={t("workspace.closePane")}
                  onClick={(e) => {
                    e.stopPropagation();
                    closePane(tab.id, pane.id);
                  }}
                  className="absolute right-1.5 top-1.5 z-10 rounded bg-bg-inset/80 p-0.5 text-fg-subtle hover:bg-border-strong hover:text-fg"
                >
                  <X size={12} />
                </button>
              )}
              {pane.content.kind === "editor" ? (
                <EditorTabContent path={pane.content.path} />
              ) : pane.content.kind === "note" ? (
                <NoteTabContent noteId={pane.content.noteId} tabId={tab.id} />
              ) : pane.content.kind === "preview" ? (
                <PreviewTabContent url={pane.content.url} />
              ) : (
                <TerminalView
                  active={active}
                  cwdTracking={active && isActiveTab}
                  cwd={tab.cwd}
                  leafId={pane.id}
                  onExit={() => closePane(tab.id, pane.id)}
                  onOpenFile={(absolutePath) =>
                    splitPaneWith(tab.id, pane.id, { kind: "editor", path: absolutePath }, "row")
                  }
                />
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
          return (
            <div
              key={splitter.id}
              onMouseDown={(e) => startDrag(e, splitter)}
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
              className={`z-20 transition-colors hover:bg-accent/40 ${
                isRow ? "cursor-col-resize" : "cursor-row-resize"
              }`}
            />
          );
        })}
      </div>
    </div>
  );
}
