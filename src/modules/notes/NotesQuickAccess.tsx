import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ClipboardList, SquareTerminal } from "lucide-react";
import { Tooltip } from "@/components/Tooltip";
import { useNotesStore } from "@/stores/notesStore";
import {
  pasteIntoActiveTerminal,
  runCommandInTerminal,
} from "@/modules/terminal/lib/terminalBus";
import {
  collectQuickBlocks,
  SHELL_LANGS,
  type NoteQuickBlocks,
} from "./lib/codeBlocks";

/**
 * StatusBar quick access to the code blocks saved in notes (#263): a floating
 * panel over the status bar listing every block grouped by note, searchable.
 * Clicking a row pastes the block into the active terminal for editing; shell
 * blocks also offer paste-and-run. The notes files are the single source of
 * truth — the panel re-scans them each time it opens, so there is no ambient
 * polling and nothing to keep in sync.
 */
export function NotesQuickAccess() {
  const { t } = useTranslation("notes");
  const rootPath = useNotesStore((s) => s.rootPath);
  const tree = useNotesStore((s) => s.tree);
  const readNote = useNotesStore((s) => s.readNote);
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState<NoteQuickBlocks[]>([]);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    let cancelled = false;
    void collectQuickBlocks(tree, readNote).then((result) => {
      if (!cancelled) {
        setNotes(result);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [open, tree, readNote]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // No notes folder configured: stay out of the status bar entirely, like the
  // Ports and Worktrees indicators do when they have nothing to show.
  if (!rootPath) {
    return null;
  }

  const needle = query.trim().toLowerCase();
  const filtered = notes
    .map((note) => ({
      ...note,
      blocks:
        needle === ""
          ? note.blocks
          : `${note.group} ${note.title}`.toLowerCase().includes(needle)
            ? note.blocks
            : note.blocks.filter((b) => b.text.toLowerCase().includes(needle)),
    }))
    .filter((note) => note.blocks.length > 0);

  const dismissAnd = (action: () => void) => {
    setOpen(false);
    setQuery("");
    action();
  };

  return (
    <div ref={containerRef} className="relative">
      <Tooltip label={t("quickAccess.title")} side="top">
        <button
          type="button"
          aria-label={t("quickAccess.title")}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className={`flex h-5 items-center gap-1 rounded px-1.5 transition-colors hover:text-fg ${
            open ? "text-fg" : "text-fg-subtle"
          }`}
        >
          <ClipboardList size={14} strokeWidth={1.75} />
        </button>
      </Tooltip>
      {open && (
        <div
          role="dialog"
          aria-label={t("quickAccess.title")}
          className="absolute bottom-7 right-0 z-50 flex max-h-96 w-96 flex-col overflow-hidden rounded-lg border border-border bg-bg-elevated shadow-xl"
        >
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("quickAccess.search")}
            className="m-2 rounded border border-border bg-bg px-2 py-1 text-xs text-fg outline-none focus:border-accent"
          />
          <div className="overflow-y-auto pb-1">
            {filtered.length === 0 && (
              <p className="px-3 py-4 text-center text-xs text-fg-subtle">
                {t("quickAccess.empty")}
              </p>
            )}
            {filtered.map((note) => (
              <section key={note.path}>
                <h3 className="truncate px-3 pb-0.5 pt-2 text-[11px] font-medium text-fg-subtle">
                  {note.group ? `${note.group} / ${note.title}` : note.title}
                </h3>
                {note.blocks.map((block, i) => (
                  <div
                    key={`${note.path}:${i}`}
                    className="group flex items-center gap-2 px-3 py-1 hover:bg-bg"
                  >
                    {/* Row click = paste for editing; the terminal icon on
                        shell blocks is the explicit paste-and-run action. */}
                    <button
                      type="button"
                      title={t("paste")}
                      onClick={() => dismissAnd(() => pasteIntoActiveTerminal(block.text))}
                      className="min-w-0 flex-1 truncate text-left font-mono text-xs text-fg-muted group-hover:text-fg"
                    >
                      {block.text.split("\n")[0]}
                    </button>
                    {block.text.includes("\n") && (
                      <span aria-hidden className="text-[10px] text-fg-subtle">
                        ⋮
                      </span>
                    )}
                    {SHELL_LANGS.has(block.lang) && (
                      <Tooltip label={t("run")} side="top">
                        <button
                          type="button"
                          aria-label={t("run")}
                          onClick={() => dismissAnd(() => runCommandInTerminal(block.text))}
                          className="rounded p-0.5 text-fg-subtle opacity-0 transition-opacity hover:text-accent group-hover:opacity-100"
                        >
                          <SquareTerminal size={13} />
                        </button>
                      </Tooltip>
                    )}
                  </div>
                ))}
              </section>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
