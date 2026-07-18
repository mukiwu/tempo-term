import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNotesStore } from "@/stores/notesStore";
import { useTabsStore } from "@/stores/tabsStore";
import { titleFromFilename } from "@/modules/notes/lib/notesPaths";
import { decideExternalChange } from "@/modules/notes/lib/notesExternalChange";
import { onNotesChanged } from "@/modules/notes/lib/notesWatch";
import { NoteEditor } from "./NoteEditor";
import { NoteToc } from "./NoteToc";
import type { Editor } from "@tiptap/react";

const WRITE_DEBOUNCE_MS = 400;
// Ignore watcher events that arrive shortly after our own write (the echo of
// saving to disk) so saving never looks like an external change.
const SELF_WRITE_WINDOW_MS = 2000;

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
  // Bumped to force the editor to remount with freshly loaded content after an
  // external reload (the editor only takes `content` as its initial value).
  const [reloadKey, setReloadKey] = useState(0);
  // True when the file changed on disk while we had unsaved edits.
  const [externalChanged, setExternalChanged] = useState(false);
  // The live editor instance, surfaced by NoteEditor for the TOC button.
  const [editor, setEditor] = useState<Editor | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const writeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Latest editor content not yet flushed to disk; null once flushed.
  const pending = useRef<string | null>(null);
  // The last write this tab made, used to ignore the watcher echo of it.
  const selfWrite = useRef<{ path: string; at: number } | null>(null);
  // True while a rename is in flight, so the remove/create events the rename
  // produces for the old and new paths don't look like external changes.
  const isRenaming = useRef(false);

  useEffect(() => {
    let cancelled = false;
    isRenaming.current = false;
    setContent(null);
    setNotFound(false);
    setExternalChanged(false);
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

  // React to the notes folder changing on disk (e.g. a cloud drive syncing in
  // edits from another machine) while this note is open.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void onNotesChanged((paths) => {
      if (isRenaming.current) {
        return;
      }
      const action = decideExternalChange({
        notePath: path,
        changedPaths: paths,
        dirty: pending.current !== null,
        selfWrite: selfWrite.current,
        now: Date.now(),
        selfWriteWindowMs: SELF_WRITE_WINDOW_MS,
      });
      if (action === "reload") {
        void reloadFromDisk();
      } else if (action === "prompt") {
        setExternalChanged(true);
      }
    }).then((fn) => {
      if (disposed) {
        fn();
      } else {
        unlisten = fn;
      }
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
    // reloadFromDisk reads only refs/state setters, so re-subscribing on `path`
    // change is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  async function reloadFromDisk() {
    if (writeTimer.current) {
      clearTimeout(writeTimer.current);
      writeTimer.current = null;
    }
    pending.current = null;
    try {
      const text = await useNotesStore.getState().readNote(path);
      setContent(text);
      setReloadKey((k) => k + 1);
      setExternalChanged(false);
    } catch {
      setNotFound(true);
    }
  }

  function persist(target: string, markdown: string) {
    selfWrite.current = { path: target, at: Date.now() };
    return useNotesStore.getState().writeNote(target, markdown);
  }

  function commitTitle() {
    void (async () => {
      const store = useNotesStore.getState();
      isRenaming.current = true;
      try {
        // Flush any pending edit to the current path first so the rename moves
        // the latest content instead of a stale debounced timer firing at the
        // old path after the file has already moved.
        if (writeTimer.current) {
          clearTimeout(writeTimer.current);
          writeTimer.current = null;
        }
        if (pending.current !== null) {
          await persist(path, pending.current);
          pending.current = null;
        }
        const newPath = await store.renameNote(path, title);
        if (newPath !== path) {
          // The path effect re-runs on setPath and clears isRenaming there.
          setPaneContent(tabId, leafId, { kind: "note", noteId: newPath });
          setPath(newPath);
        } else {
          isRenaming.current = false;
        }
        const finalTitle = titleFromFilename(basename(newPath));
        setTitle(finalTitle);
        setTabTitle(tabId, finalTitle || "Untitled");
      } catch {
        // Rename refused (e.g. a name collision); resync the input to the
        // on-disk name and reload the tree so the UI reflects reality.
        isRenaming.current = false;
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
      void persist(target, markdown);
    }, WRITE_DEBOUNCE_MS);
  }

  function keepMine() {
    const markdown = pending.current ?? content ?? "";
    void persist(path, markdown);
    pending.current = null;
    setExternalChanged(false);
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
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-6 pt-5 pb-2">
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
          className="w-full min-w-0 flex-1 bg-transparent text-2xl font-bold text-fg outline-none placeholder:text-fg-subtle"
        />
        <NoteToc editor={editor} scrollContainerRef={scrollContainerRef} />
      </div>
      {externalChanged && (
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-warning/10 px-6 py-2 text-xs text-fg">
          <span>{t("externalChanged")}</span>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => void reloadFromDisk()}
              className="rounded border border-border-strong px-2 py-0.5 hover:bg-border-strong"
            >
              {t("useDiskVersion")}
            </button>
            <button
              type="button"
              onClick={keepMine}
              className="rounded border border-border-strong px-2 py-0.5 hover:bg-border-strong"
            >
              {t("keepMine")}
            </button>
          </div>
        </div>
      )}
      <div ref={scrollContainerRef} className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        {content === null ? (
          <p className="text-sm text-fg-subtle">{t("loading")}</p>
        ) : (
          <NoteEditor
            key={`${path}#${reloadKey}`}
            noteId={path}
            content={content}
            onChange={scheduleWrite}
            onEditorReady={setEditor}
          />
        )}
      </div>
    </div>
  );
}
