import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNotesStore } from "@/stores/notesStore";
import { useTabsStore } from "@/stores/tabsStore";
import { titleFromFilename } from "@/modules/notes/lib/notesPaths";
import { NoteEditor } from "./NoteEditor";

const WRITE_DEBOUNCE_MS = 400;

function basename(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx < 0 ? path : path.slice(idx + 1);
}

interface NoteTabContentProps {
  noteId: string;
  tabId: string;
  leafId: string;
}

export function NoteTabContent({ noteId, tabId, leafId }: NoteTabContentProps) {
  const { t } = useTranslation("notes");
  const setTabTitle = useTabsStore((s) => s.setTabTitle);
  const setPaneContent = useTabsStore((s) => s.setPaneContent);

  const [path, setPath] = useState(noteId);
  const [title, setTitle] = useState(() => titleFromFilename(basename(noteId)));
  const [content, setContent] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const writeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Latest editor content not yet flushed to disk, so a rename can persist it
  // to the current path before moving the file.
  const pending = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setContent(null);
    setNotFound(false);
    void (async () => {
      try {
        const text = await useNotesStore.getState().readNote(path);
        if (!cancelled) {
          setContent(text);
        }
      } catch {
        if (!cancelled) {
          setNotFound(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [path]);

  useEffect(() => {
    return () => {
      if (writeTimer.current) {
        clearTimeout(writeTimer.current);
      }
    };
  }, []);

  function commitTitle() {
    void (async () => {
      const store = useNotesStore.getState();
      try {
        // Flush any pending edit to the current path first so the rename moves
        // the latest content instead of a stale debounced timer firing at the
        // old path after the file has already moved.
        if (writeTimer.current) {
          clearTimeout(writeTimer.current);
          writeTimer.current = null;
        }
        if (pending.current !== null) {
          await store.writeNote(path, pending.current);
          pending.current = null;
        }
        const newPath = await store.renameNote(path, title);
        if (newPath !== path) {
          setPaneContent(tabId, leafId, { kind: "note", noteId: newPath });
          setPath(newPath);
        }
        const finalTitle = titleFromFilename(basename(newPath));
        setTitle(finalTitle);
        setTabTitle(tabId, finalTitle || "Untitled");
      } catch {
        // Rename refused (e.g. a name collision); resync the input to the
        // on-disk name and reload the tree so the UI reflects reality.
        setTitle(titleFromFilename(basename(path)));
        void store.refresh();
      }
    })();
  }

  function scheduleWrite(markdown: string) {
    pending.current = markdown;
    if (writeTimer.current) {
      clearTimeout(writeTimer.current);
    }
    const target = path;
    writeTimer.current = setTimeout(() => {
      pending.current = null;
      void useNotesStore.getState().writeNote(target, markdown);
    }, WRITE_DEBOUNCE_MS);
  }

  if (notFound) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-fg-subtle">
        {t("notFound")}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-bg">
      <div className="shrink-0 border-b border-border px-6 pt-5 pb-2">
        <input
          value={title}
          placeholder={t("titlePlaceholder")}
          aria-label={t("titlePlaceholder")}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.currentTarget.blur();
            }
          }}
          className="w-full bg-transparent text-2xl font-bold text-fg outline-none placeholder:text-fg-subtle"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        {content === null ? (
          <p className="text-sm text-fg-subtle">{t("loading")}</p>
        ) : (
          <NoteEditor
            key={path}
            noteId={path}
            content={content}
            onChange={scheduleWrite}
          />
        )}
      </div>
    </div>
  );
}
