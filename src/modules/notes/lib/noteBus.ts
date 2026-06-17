/**
 * Lets a dropped explorer entry insert a Markdown link into an open note. The
 * note editor registers an inserter keyed by note id; the drop target calls it.
 */
type NoteInserter = (name: string, path: string) => void;

const inserters = new Map<string, NoteInserter>();

export function registerNoteInserter(noteId: string, insert: NoteInserter): void {
  inserters.set(noteId, insert);
}

export function unregisterNoteInserter(noteId: string): void {
  inserters.delete(noteId);
}

/** Insert a link into the note's editor if it's mounted; returns whether it was. */
export function insertLinkIntoNote(noteId: string, name: string, path: string): boolean {
  const insert = inserters.get(noteId);
  if (insert) {
    insert(name, path);
    return true;
  }
  return false;
}
