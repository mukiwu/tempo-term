import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { TableOfContents } from "lucide-react";
import type { Editor } from "@tiptap/react";
import { Tooltip } from "@/components/Tooltip";
import { extractHeadings, type NoteHeading } from "./lib/noteToc";

/**
 * The note's table-of-contents control: a title-row button that pops a
 * floating panel of the note's headings. Headings are read from the editor doc
 * at open time (no live subscription — the list is fresh on every open, which
 * is when it matters). Clicking one places the cursor on that heading and
 * smooth-scrolls it into view; clicking outside closes the panel.
 */
export function NoteToc({ editor }: { editor: Editor | null }) {
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
    // Cursor onto the heading without the focus scroll (which jumps hard);
    // the DOM node scrolls smoothly instead. `pos + 1` lands inside the node.
    editor
      .chain()
      .setTextSelection(heading.pos + 1)
      .focus(undefined, { scrollIntoView: false })
      .run();
    const dom = editor.view.nodeDOM(heading.pos);
    if (dom instanceof HTMLElement) {
      dom.scrollIntoView?.({ behavior: "smooth", block: "start" });
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
