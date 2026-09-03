import { create } from "zustand";

/** The file a click on a Source Control row is asking to be scrolled to. */
export interface AllChangesFile {
  /** Repo-relative path, as `gitStatus` reports it. */
  rel: string;
  /** Which of the two sections the row came from. */
  staged: boolean;
}

interface AllChangesLinkState {
  /** Panel to page: scroll to this file. A one-shot request. */
  file: AllChangesFile | null;
  /** Ask the all-changes page to scroll to this file once it can. */
  request: (file: AllChangesFile) => void;
  /** Read and clear the pending file; null if nothing is pending. */
  consume: () => AllChangesFile | null;

  /**
   * Page to panel: the file at the top of the page as it is read, so the
   * panel can mark the row the reader is on. Standing state, not a request —
   * null while no such page is up.
   */
  showing: AllChangesFile | null;
  setShowing: (file: AllChangesFile | null) => void;
}

/**
 * The link between the Source Control panel and the all-changes page. The page
 * is a singleton per space (openAllChangesTab always focuses the one tab), so
 * there is no per-tab PaneContent field to route this through; the Git Graph
 * tab's pending commit selection has the same shape and the same reason.
 *
 * Clearing on consume is what lets the same row be clicked twice: the second
 * request is a real state change because the first left the field null.
 */
export const useAllChangesLinkStore = create<AllChangesLinkState>((set, get) => ({
  file: null,
  request: (file) => set({ file }),
  consume: () => {
    const file = get().file;
    set({ file: null });
    return file;
  },

  showing: null,
  setShowing: (file) => {
    // Written as the page scrolls, so it must not churn: an unchanged value
    // would re-render the panel on every frame.
    const had = get().showing;
    if (had?.rel === file?.rel && had?.staged === file?.staged) {
      return;
    }
    set({ showing: file });
  },
}));
