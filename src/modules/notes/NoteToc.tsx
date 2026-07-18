import { useEffect, useRef, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { TableOfContents } from "lucide-react";
import type { Editor } from "@tiptap/react";
import { Tooltip } from "@/components/Tooltip";
import { extractHeadings, type NoteHeading } from "./lib/noteToc";

/** Nearest ancestor that actually scrolls vertically, or null. */
function scrollableAncestor(el: HTMLElement): HTMLElement | null {
  for (let cur = el.parentElement; cur; cur = cur.parentElement) {
    const { overflowY } = window.getComputedStyle(cur);
    if ((overflowY === "auto" || overflowY === "scroll") && cur.scrollHeight > cur.clientHeight) {
      return cur;
    }
  }
  return null;
}

/** Resolve the heading element through the rendered DOM position. In WebKit,
 * `nodeDOM(pos)` can return a detached ProseMirror node whose rect is all zero. */
function renderedHeadingAt(editor: Editor, pos: number): HTMLElement | null {
  const atPos = editor.view.domAtPos(pos + 1).node;
  const element = atPos instanceof Element ? atPos : atPos.parentElement;
  const rendered = element?.closest("h1, h2, h3, h4, h5, h6");
  if (rendered instanceof HTMLElement) {
    return rendered;
  }
  const fallback = editor.view.nodeDOM(pos);
  return fallback instanceof HTMLElement ? fallback : null;
}

/**
 * The note's table-of-contents control: a title-row button that pops a
 * floating panel of the note's headings. Headings are read from the editor doc
 * at open time (no live subscription — the list is fresh on every open, which
 * is when it matters). Clicking one places the cursor on that heading and
 * smooth-scrolls it into view; clicking outside closes the panel.
 */
interface NoteTocProps {
  editor: Editor | null;
  /** The note body owns scrolling; passing it explicitly avoids relying on
   *  WKWebView's inconsistent computed overflow metrics. */
  scrollContainerRef?: RefObject<HTMLElement | null>;
}

export function NoteToc({ editor, scrollContainerRef }: NoteTocProps) {
  const { t } = useTranslation("notes");
  const [open, setOpen] = useState(false);
  const [headings, setHeadings] = useState<NoteHeading[]>([]);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onPointerDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  if (!editor) {
    return null;
  }

  const toggle = () => {
    if (!open) {
      setHeadings(extractHeadings(editor.state.doc));
    }
    setOpen((o) => !o);
  };

  const jump = (heading: NoteHeading) => {
    // Cursor onto the heading without the focus scroll; the DOM node is
    // positioned directly instead. `pos + 1` lands inside the node.
    editor
      .chain()
      .setTextSelection(heading.pos + 1)
      .focus(undefined, { scrollIntoView: false })
      .run();
    const dom = renderedHeadingAt(editor, heading.pos);
    if (dom) {
      // WKWebView's scrollIntoView is unreliable inside nested scroll
      // containers (smooth miscomputes the target, instant silently no-ops),
      // so the scroll container is positioned by hand from rect geometry.
      // Deferred a tick so the webview's own reveal-the-caret scroll (async,
      // minimal) runs first and finds the caret already visible at the top
      // instead of fighting this jump. scrollIntoView stays as the fallback
      // when no scrollable ancestor is found.
      window.setTimeout(() => {
        const container = scrollContainerRef?.current ?? scrollableAncestor(dom);
        if (container) {
          // Absolute target, clamped to the scroll range and re-asserted while
          // layout settles. Measuring and applying together is idempotent when
          // nothing moved, and overrides any late native caret-reveal scroll.
          const previousScrollBehavior = container.style.scrollBehavior;
          container.style.scrollBehavior = "auto";
          const apply = () => {
            const coordsTop = editor.view.coordsAtPos(heading.pos + 1).top;
            const domTop = dom.getBoundingClientRect().top;
            // jsdom and some transient WebKit layouts report 0 from one of
            // these APIs. Prefer ProseMirror's position geometry in the real
            // editor, falling back to the element rect when it has the only
            // usable measurement.
            const headingTop = coordsTop === 0 && domTop !== 0 ? domTop : coordsTop;
            const delta =
              headingTop - container.getBoundingClientRect().top - 12;
            const max = container.scrollHeight - container.clientHeight;
            const target = Math.max(0, Math.min(container.scrollTop + delta, max));
            container.scrollTop = target;
            return target;
          };
          // The document's layout can still be settling when the jump runs
          // (measured positions shifted by thousands of px one frame later on
          // a real note), so a fixed number of corrections isn't enough:
          // keep re-measuring and re-asserting every frame until the target
          // stops moving, with a hard cap as the safety valve.
          let last = apply();
          let frames = 0;
          let stableFrames = 0;
          const settle = () => {
            const target = apply();
            frames += 1;
            const moved = Math.abs(target - last) >= 2;
            stableFrames = moved ? 0 : stableFrames + 1;
            last = target;
            // One stable frame does not mean layout is finished: React node
            // views and WebKit can reflow the editor a frame or two later.
            // Require a short stable window before releasing the scroll, while
            // retaining the hard cap for continuously changing content.
            if (stableFrames < 4 && frames < 30) {
              requestAnimationFrame(settle);
            } else {
              container.style.scrollBehavior = previousScrollBehavior;
            }
          };
          requestAnimationFrame(settle);
        } else {
          dom.scrollIntoView?.({ block: "start" });
        }
        // Flash the landing heading so the destination reads clearly even
        // when the scroll hit the end of the document and couldn't bring it
        // to the top. Re-added after a reflow so a repeated jump restarts
        // the animation; the timeout removal covers reduced-motion users,
        // whose static highlight never fires animationend.
        dom.classList.remove("note-toc-flash");
        void dom.offsetWidth;
        dom.classList.add("note-toc-flash");
        const clear = () => dom.classList.remove("note-toc-flash");
        dom.addEventListener("animationend", clear, { once: true });
        window.setTimeout(clear, 2000);
      }, 0);
    }
    setOpen(false);
  };

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <Tooltip label={t("toc")}>
        <button
          type="button"
          aria-label={t("toc")}
          aria-expanded={open}
          onClick={toggle}
          className={`rounded p-1.5 transition-colors ${
            open ? "bg-bg-elevated text-fg" : "text-fg-subtle hover:bg-bg-elevated hover:text-fg"
          }`}
        >
          <TableOfContents size={16} />
        </button>
      </Tooltip>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1.5 max-h-72 w-64 overflow-y-auto rounded-lg border border-border-strong bg-bg-elevated p-1 shadow-xl">
          {headings.length === 0 ? (
            <p className="px-2 py-1.5 text-xs text-fg-subtle">{t("tocEmpty")}</p>
          ) : (
            <ul>
              {headings.map((heading) => (
                <li key={heading.pos}>
                  <button
                    type="button"
                    onClick={() => jump(heading)}
                    style={{ paddingLeft: `${8 + (heading.level - 1) * 12}px` }}
                    className="w-full truncate rounded-md py-1 pr-2 text-left text-xs text-fg-muted hover:bg-bg hover:text-fg"
                  >
                    {heading.text || t("tocUntitled")}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
