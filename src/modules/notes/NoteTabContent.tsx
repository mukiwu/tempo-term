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

export function NoteTabContent({ noteId, tabId }: { noteId: string; tabId: string }) {
  const { t } = useTranslation("notes");
  const setTabTitle = useTabsStore((s) => s.setTabTitle);

  const [path, setPath] = useState(noteId);
  const [title, setTitle] = useState(() => titleFromFilename(basename(noteId)));
  const [content, setContent] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const writeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      const newPath = await useNotesStore.getState().renameNote(path, title);
      setPath(newPath);
      setTitle(titleFromFilename(basename(newPath)));
      setTabTitle(tabId, title || "Untitled");
    })();
  }

  function scheduleWrite(markdown: string) {
    if (writeTimer.current) {
      clearTimeout(writeTimer.current);
    }
    const target = path;
    writeTimer.current = setTimeout(() => {
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
