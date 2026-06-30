import { create } from "zustand";
import { persist } from "zustand/middleware";
import { terminalFontFamilyFor } from "@/modules/fonts/lib/fontChain";
import { fetchFontReport, type FontReport } from "@/modules/fonts/lib/fontsBridge";

export const MIN_FONT_SIZE = 8;
export const MAX_FONT_SIZE = 32;
export const DEFAULT_FONT_SIZE = 13;

interface FontState {
  /** User-selected primary monospace family. Empty means use defaults. */
  primaryFont: string;
  /**
   * User-selected icon / Powerline font (e.g. a Nerd Font). Empty means use the
   * backend-detected suggestion (`report.suggested_icon_fallback`). Consulted
   * AFTER the Latin monospace anchors so it only catches Private Use Area
   * glyphs that the anchors lack.
   */
  iconFont: string;
  /** User-selected Traditional Chinese fallback. Empty means auto-detect. */
  cjkFallbackFont: string;
  fontSize: number;
  report: FontReport | null;
  loading: boolean;
  setPrimaryFont: (family: string) => void;
  setIconFont: (family: string) => void;
  setCjkFallbackFont: (family: string) => void;
  setFontSize: (size: number) => void;
  loadReport: (force?: boolean) => Promise<void>;
}

export const FONT_STORAGE_KEY = "tempoterm-fonts";

function clamp(value: number): number {
  if (Number.isNaN(value)) {
    return DEFAULT_FONT_SIZE;
  }
  return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(value)));
}

export const useFontStore = create<FontState>()(
  persist(
    (set, get) => ({
      primaryFont: "",
      iconFont: "",
      cjkFallbackFont: "",
      fontSize: DEFAULT_FONT_SIZE,
      report: null,
      loading: false,

      setPrimaryFont: (primaryFont) => set({ primaryFont }),
      setIconFont: (iconFont) => set({ iconFont }),
      setCjkFallbackFont: (cjkFallbackFont) => set({ cjkFallbackFont }),
      setFontSize: (size) => set({ fontSize: clamp(size) }),

      loadReport: async (force = false) => {
        const state = get();
        if (state.loading || (state.report && !force)) {
          return;
        }
        set({ loading: true });
        try {
          const report = await fetchFontReport();
          set({ report, loading: false });
        } catch {
          set({ loading: false });
        }
      },
    }),
    {
      name: FONT_STORAGE_KEY,
      partialize: (state) => ({
        primaryFont: state.primaryFont,
        iconFont: state.iconFont,
        cjkFallbackFont: state.cjkFallbackFont,
        fontSize: state.fontSize,
      }),
    },
  ),
);

/** Derive the effective xterm font-family stack from the current store state. */
export function selectTerminalFontFamily(state: FontState): string {
  return terminalFontFamilyFor(
    state.primaryFont,
    state.cjkFallbackFont,
    state.report?.suggested_cjk_fallback ?? null,
    state.iconFont,
    state.report?.suggested_icon_fallback ?? null,
  );
}
