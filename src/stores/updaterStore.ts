import { create } from "zustand";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

// Where a given version's release notes live, so the modal can deep-link out.
const RELEASE_TAG_BASE = "https://github.com/mukiwu/tempo-term/releases/tag/v";

export type UpdaterStatus = "idle" | "checking" | "upToDate" | "error";

/** Bytes fetched so far; total is null when the server sends no Content-Length. */
export interface DownloadProgress {
  downloaded: number;
  total: number | null;
}

export type InstallPhase = "downloading" | "installing";

export interface AvailableUpdate {
  version: string;
  notes: string;
  releaseUrl: string;
  update: Update;
}

interface UpdaterState {
  /** Feedback for the manual check only; never "available" (that is `available`). */
  status: UpdaterStatus;
  /** Single source of truth that a newer build exists; drives the status-bar dot. */
  available: AvailableUpdate | null;
  /** Whether the UpdateModal is shown. */
  modalOpen: boolean;
  /** Transient corner toast to render, or null. */
  toast: { version: string } | null;
  /** Versions already surfaced this session (modal or toast); resets on relaunch. */
  notifiedVersions: string[];
  installing: boolean;
  /** Live byte counts for the running download, or null outside an install. */
  progress: DownloadProgress | null;
  /** Which leg of the install is running, so the modal can label the wait. */
  installPhase: InstallPhase | null;
  errorMessage: string;
  /** Launch-time silent check: opens the modal directly on a hit. */
  runLaunchCheck: () => Promise<void>;
  /** Interval silent check: toasts once per session per version, never nags. */
  runPeriodicCheck: () => Promise<void>;
  /** Manual check from settings: surfaces checking/upToDate/error, opens modal on a hit. */
  checkManually: () => Promise<void>;
  openModal: () => void;
  dismissModal: () => void;
  clearToast: () => void;
  installUpdate: () => Promise<void>;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : "unexpected error";
}

/**
 * Ask the update server for a newer build. A silent check never touches `status`
 * (no "up to date"/"error" nagging); a visible check drives it. Always sets
 * `available` on a hit and returns it so callers decide how to present it.
 */
async function runCheck(
  apply: (partial: Partial<UpdaterState>) => void,
  silent: boolean,
): Promise<AvailableUpdate | null> {
  if (!silent) {
    apply({ status: "checking", errorMessage: "" });
  }
  try {
    const update = await check();
    if (update) {
      const found: AvailableUpdate = {
        version: update.version,
        notes: update.body ?? "",
        releaseUrl: `${RELEASE_TAG_BASE}${update.version}`,
        update,
      };
      apply({ available: found });
      return found;
    }
    if (!silent) {
      apply({ status: "upToDate" });
    }
    return null;
  } catch (err: unknown) {
    if (!silent) {
      apply({ status: "error", errorMessage: messageOf(err) });
    }
    return null;
  }
}

export const useUpdaterStore = create<UpdaterState>((set, get) => ({
  status: "idle",
  available: null,
  modalOpen: false,
  toast: null,
  notifiedVersions: [],
  installing: false,
  progress: null,
  installPhase: null,
  errorMessage: "",

  runLaunchCheck: async () => {
    const found = await runCheck((p) => set(p), true);
    if (found) {
      get().openModal();
    }
  },

  runPeriodicCheck: async () => {
    // An install is mid-flight (download + relaunch); a background check then is
    // redundant and could toast over the install.
    if (get().installing) {
      return;
    }
    const found = await runCheck((p) => set(p), true);
    if (found && !get().notifiedVersions.includes(found.version)) {
      set((s) => ({
        toast: { version: found.version },
        notifiedVersions: [...s.notifiedVersions, found.version],
      }));
    }
  },

  checkManually: async () => {
    const found = await runCheck((p) => set(p), false);
    if (found) {
      get().openModal();
    }
  },

  openModal: () => {
    const a = get().available;
    set((s) => ({
      modalOpen: true,
      toast: null,
      notifiedVersions:
        a && !s.notifiedVersions.includes(a.version)
          ? [...s.notifiedVersions, a.version]
          : s.notifiedVersions,
    }));
  },

  dismissModal: () => set({ modalOpen: false }),

  clearToast: () => set({ toast: null }),

  installUpdate: async () => {
    const a = get().available;
    if (!a) {
      return;
    }
    set({ installing: true, installPhase: "downloading", progress: null, errorMessage: "" });
    try {
      await a.update.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            // A zero Content-Length carries no information; treat it as unknown
            // so the modal never divides by it.
            set({ progress: { downloaded: 0, total: event.data.contentLength || null } });
            break;
          case "Progress":
            set((s) => ({
              progress: {
                downloaded: (s.progress?.downloaded ?? 0) + event.data.chunkLength,
                total: s.progress?.total ?? null,
              },
            }));
            break;
          case "Finished":
            set({ installPhase: "installing" });
            break;
        }
      });
      await relaunch();
    } catch (err: unknown) {
      set({
        installing: false,
        installPhase: null,
        progress: null,
        status: "error",
        errorMessage: messageOf(err),
      });
    }
  },
}));
