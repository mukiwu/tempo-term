import { create } from "zustand";

/** The file a click on a Source Control row is asking to be scrolled to. */
export interface AllChangesFile {
  /** Repo-relative path, as `gitStatus` reports it. */
  rel: string;
  /** Which of the two sections the row came from. */
  staged: boolean;
}

interface AllChangesLinkState {
  /** Panel to page, by pane: scroll to this file. A one-shot request. */
  file: Readonly<Record<string, AllChangesFile>>;
  /** Ask one page to scroll to this file once it can. */
  request: (pane: string, file: AllChangesFile) => void;
  /** Read and clear that page's pending file; null if nothing is pending. */
  consume: (pane: string) => AllChangesFile | null;

  /**
   * Page to panel, by pane: the file at the top of each page as it is read,
   * so the panel can mark the row the reader is on. Standing state, not a
   * request — a pane with no entry has no such page up.
   */
  showing: Readonly<Record<string, AllChangesFile>>;
  setShowing: (pane: string, file: AllChangesFile | null) => void;

  /**
   * Panel to page, by pane: rescan the working tree. Bumped by the panel's
   * refresh button, which is the only refresh control on screen while that
   * page has the pane — the two are reading one list, so they reload together
   * or they disagree side by side.
   */
  rescan: Readonly<Record<string, number>>;
  requestRescan: (pane: string) => void;

  /** Drop everything a pane published, as it goes. */
  forget: (pane: string) => void;
}

/**
 * The link between the Source Control panel and the all-changes page. The tab
 * is a singleton per space (openAllChangesTab always focuses the one tab), so
 * there is no per-tab PaneContent field to route this through; the Git Graph
 * tab's pending commit selection has the same shape and the same reason.
 *
 * Keyed by pane, though, because a tab is not a pane: split one and two
 * all-changes pages are mounted at once, each scrolling its own way. Held
 * globally with one entry each, a second page overwrites the first's mark and
 * closing either clears a mark still on screen. The panel reads the entry of
 * whichever pane is in front, which is the page its rows belong to.
 *
 * Clearing on consume is what lets the same row be clicked twice: the second
 * request is a real state change because the first left the entry empty.
 */
export const useAllChangesLinkStore = create<AllChangesLinkState>((set, get) => ({
  file: {},
  request: (pane, file) => set((state) => ({ file: { ...state.file, [pane]: file } })),
  consume: (pane) => {
    const file = get().file[pane] ?? null;
    if (file) {
      set((state) => {
        const next = { ...state.file };
        delete next[pane];
        return { file: next };
      });
    }
    return file;
  },

  rescan: {},
  requestRescan: (pane) =>
    set((state) => ({ rescan: { ...state.rescan, [pane]: (state.rescan[pane] ?? 0) + 1 } })),

  showing: {},
  setShowing: (pane, file) => {
    // Written as the page scrolls, so it must not churn: an unchanged value
    // would re-render the panel on every frame.
    const had = get().showing[pane] ?? null;
    if (had?.rel === file?.rel && had?.staged === file?.staged) {
      return;
    }
    set((state) => {
      const next = { ...state.showing };
      if (file) {
        next[pane] = file;
      } else {
        delete next[pane];
      }
      return { showing: next };
    });
  },

  forget: (pane) =>
    set((state) => {
      const file = { ...state.file };
      const showing = { ...state.showing };
      const rescan = { ...state.rescan };
      delete file[pane];
      delete showing[pane];
      delete rescan[pane];
      return { file, showing, rescan };
    }),
}));
