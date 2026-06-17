import { create } from "zustand";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

// Where a given version's release notes live, so the modal can deep-link out.
const RELEASE_TAG_BASE = "https://github.com/mukiwu/tempo-term/releases/tag/v";

export type UpdaterStatus = "idle" | "checking" | "upToDate" | "available" | "error";

interface UpdaterState {
  status: UpdaterStatus;
  version: string;
  notes: string;
  releaseUrl: string;
  update: Update | null;
  installing: boolean;
  errorMessage: string;
  /**
   * Ask the update server whether a newer build exists. A `silent` check (run
   * in the background on launch) only ever flips to "available"; it never shows
   * the "up to date" or error states, so the user isn't nagged on every start.
   */
  checkForUpdate: (opts?: { silent?: boolean }) => Promise<void>;
  /** Download + install the pending update, then relaunch into it. */
  installUpdate: () => Promise<void>;
  /** Close the update prompt without installing. */
  dismiss: () => void;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : "unexpected error";
}

export const useUpdaterStore = create<UpdaterState>((set, get) => ({
  status: "idle",
  version: "",
  notes: "",
  releaseUrl: "",
  update: null,
  installing: false,
  errorMessage: "",

  checkForUpdate: async (opts) => {
    if (!opts?.silent) {
      set({ status: "checking", errorMessage: "" });
    }
    try {
      const update = await check();
      if (update) {
        set({
          status: "available",
          version: update.version,
          notes: update.body ?? "",
          releaseUrl: `${RELEASE_TAG_BASE}${update.version}`,
          update,
        });
      } else if (!opts?.silent) {
        set({ status: "upToDate" });
      }
    } catch (err: unknown) {
      if (!opts?.silent) {
        set({ status: "error", errorMessage: messageOf(err) });
      }
    }
  },

  installUpdate: async () => {
    const { update } = get();
    if (!update) {
      return;
    }
    set({ installing: true, errorMessage: "" });
    try {
      await update.downloadAndInstall();
      await relaunch();
    } catch (err: unknown) {
      set({ installing: false, status: "error", errorMessage: messageOf(err) });
    }
  },

  dismiss: () => set({ status: "idle" }),
}));
