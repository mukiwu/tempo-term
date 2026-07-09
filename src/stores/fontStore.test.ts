import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  FONT_STORAGE_KEY,
  selectTerminalFontFamily,
  shouldPrefetchFontReport,
  useFontStore,
} from "./fontStore";
import { fetchFontReport, type FontReport } from "@/modules/fonts/lib/fontsBridge";

vi.mock("@/modules/fonts/lib/fontsBridge", () => ({
  fetchFontReport: vi.fn(),
}));

function report(overrides: Partial<FontReport> = {}): FontReport {
  return {
    fonts: [],
    recommended_cjk: [],
    suggested_cjk_fallback: null,
    has_cjk_fallback: false,
    suggested_icon_fallback: null,
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
  vi.mocked(fetchFontReport).mockReset();
  useFontStore.setState({
    primaryFont: "",
    iconFont: "",
    cjkFallbackFont: "",
    cachedIconFallback: "",
    report: null,
    loading: false,
  });
});

// Regression tests for #164: with the icon font on auto-detect, the suggested
// Nerd Font must reach the chain at startup (before the settings panel ever
// loads the full report), or PUA glyphs render as tofu until the user re-picks
// a font — on every launch.
describe("cached icon fallback in the font chain", () => {
  it("uses the cached suggestion before the report loads", () => {
    useFontStore.setState({ cachedIconFallback: "MesloLGS NF" });
    const chain = selectTerminalFontFamily(useFontStore.getState());
    expect(chain).toContain('"MesloLGS NF"');
  });

  it("prefers a loaded report over the cache", () => {
    useFontStore.setState({
      cachedIconFallback: "MesloLGS NF",
      report: report({ suggested_icon_fallback: "Hack Nerd Font Mono" }),
    });
    const chain = selectTerminalFontFamily(useFontStore.getState());
    expect(chain).toContain('"Hack Nerd Font Mono"');
    expect(chain).not.toContain('"MesloLGS NF"');
  });

  it("trusts a loaded report that found no icon font, even with a stale cache", () => {
    useFontStore.setState({
      cachedIconFallback: "Gone Nerd Font",
      report: report({ suggested_icon_fallback: null }),
    });
    expect(selectTerminalFontFamily(useFontStore.getState())).not.toContain("Nerd");
  });

  it("is overridden by an explicit user icon font", () => {
    useFontStore.setState({
      iconFont: "FiraCode Nerd Font Mono",
      cachedIconFallback: "MesloLGS NF",
    });
    const chain = selectTerminalFontFamily(useFontStore.getState());
    expect(chain).toContain('"FiraCode Nerd Font Mono"');
    expect(chain).not.toContain('"MesloLGS NF"');
  });

  it('is disabled entirely by the "none" sentinel', () => {
    useFontStore.setState({ iconFont: "none", cachedIconFallback: "MesloLGS NF" });
    expect(selectTerminalFontFamily(useFontStore.getState())).not.toContain("Nerd");
    expect(selectTerminalFontFamily(useFontStore.getState())).not.toContain("MesloLGS");
  });
});

describe("loadReport caching", () => {
  it("persists the detected icon fallback for the next launch", async () => {
    vi.mocked(fetchFontReport).mockResolvedValue(
      report({ suggested_icon_fallback: "MesloLGS NF" }),
    );
    await useFontStore.getState().loadReport();
    expect(useFontStore.getState().cachedIconFallback).toBe("MesloLGS NF");
    const persisted = JSON.parse(localStorage.getItem(FONT_STORAGE_KEY) ?? "{}") as {
      state?: { cachedIconFallback?: string };
    };
    expect(persisted.state?.cachedIconFallback).toBe("MesloLGS NF");
  });

  it("clears a stale cache when the report finds no icon font", async () => {
    useFontStore.setState({ cachedIconFallback: "Gone Nerd Font" });
    vi.mocked(fetchFontReport).mockResolvedValue(report({ suggested_icon_fallback: null }));
    await useFontStore.getState().loadReport();
    expect(useFontStore.getState().cachedIconFallback).toBe("");
  });
});

describe("shouldPrefetchFontReport", () => {
  it("asks for a prefetch only on auto mode with nothing cached or loaded", () => {
    expect(shouldPrefetchFontReport(useFontStore.getState())).toBe(true);
  });

  it("skips the prefetch when a suggestion is already cached", () => {
    useFontStore.setState({ cachedIconFallback: "MesloLGS NF" });
    expect(shouldPrefetchFontReport(useFontStore.getState())).toBe(false);
  });

  it("skips the prefetch when the user chose a font or opted out", () => {
    useFontStore.setState({ iconFont: "FiraCode Nerd Font Mono" });
    expect(shouldPrefetchFontReport(useFontStore.getState())).toBe(false);
    useFontStore.setState({ iconFont: "none" });
    expect(shouldPrefetchFontReport(useFontStore.getState())).toBe(false);
  });

  it("skips the prefetch when the report is loaded or loading", () => {
    useFontStore.setState({ report: report() });
    expect(shouldPrefetchFontReport(useFontStore.getState())).toBe(false);
    useFontStore.setState({ report: null, loading: true });
    expect(shouldPrefetchFontReport(useFontStore.getState())).toBe(false);
  });
});
