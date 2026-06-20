import { create } from "zustand";
import { ghAvailable, prViaApi, prViaGh, type PrInfo } from "./prBridge";

/** Where PR data comes from; mirrors the settings option. */
export type PrSource = "auto" | "gh" | "token" | "off";

interface PrStoreState {
  /**
   * PR per directory (keyed by cwd, not branch, so two repos sharing a branch
   * name never collide). A null value means "checked, no PR".
   */
  prs: Record<string, PrInfo | null>;
  fetchedAt: Record<string, number>;
  refresh: (cwd: string, branch: string, source: PrSource) => Promise<void>;
}

async function fetchPr(cwd: string, branch: string, source: PrSource): Promise<PrInfo | null> {
  if (source === "gh") {
    return prViaGh(cwd, branch);
  }
  if (source === "token") {
    return prViaApi(cwd, branch);
  }
  // auto: prefer gh when installed, otherwise fall back to the API token.
  if (await ghAvailable()) {
    return prViaGh(cwd, branch);
  }
  return prViaApi(cwd, branch);
}

export const usePrStore = create<PrStoreState>((set) => ({
  prs: {},
  fetchedAt: {},

  refresh: async (cwd, branch, source) => {
    if (source === "off" || !branch) {
      return;
    }
    try {
      const pr = await fetchPr(cwd, branch, source);
      set((state) => ({
        prs: { ...state.prs, [cwd]: pr },
        fetchedAt: { ...state.fetchedAt, [cwd]: Date.now() },
      }));
    } catch {
      // gh missing, no token, or network error: keep any previous PR value but
      // still stamp the fetch time so a failing cwd is not retried every focus.
      set((state) => ({
        fetchedAt: { ...state.fetchedAt, [cwd]: Date.now() },
      }));
    }
  },
}));
