import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Loader2 } from "lucide-react";
import {
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  selectTerminalFontFamily,
  useFontStore,
} from "@/stores/fontStore";

export function FontsSettingsSection() {
  const { t } = useTranslation("settings");
  const {
    primaryFont,
    cjkFallbackFont,
    fontSize,
    report,
    loading,
    setPrimaryFont,
    setCjkFallbackFont,
    setFontSize,
    loadReport,
  } = useFontStore();

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  const monospaceFonts = useMemo(
    () => (report?.fonts ?? []).filter((f) => f.monospace),
    [report],
  );
  // CJK fallbacks need not be monospace: xterm lays glyphs out by cell, so a
  // native proportional font like PingFang TC works well. Monospace CJK fonts
  // are listed first as the preferred choices.
  const cjkFonts = useMemo(() => {
    const cjk = (report?.fonts ?? []).filter((f) => f.has_cjk);
    return [...cjk].sort((a, b) => Number(b.monospace) - Number(a.monospace));
  }, [report]);

  const previewFamily = useFontStore(selectTerminalFontFamily);
  const missingCjk = report ? !report.has_cjk_fallback : false;

  return (
    <section>
      <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-[--color-fg-subtle]">
        {t("sections.fonts")}
      </h2>
      <p className="mb-6 text-xs text-[--color-fg-muted]">{t("fonts.description")}</p>

      {loading && (
        <div className="mb-4 flex items-center gap-2 text-xs text-[--color-fg-muted]">
          <Loader2 size={14} className="animate-spin" />
          {t("fonts.loading")}
        </div>
      )}

      {/* Live preview */}
      <div className="mb-6 rounded-lg border border-[--color-border] bg-[--color-bg-inset] p-4">
        <div className="mb-2 text-xs text-[--color-fg-subtle]">{t("fonts.preview")}</div>
        <div
          className="text-[--color-fg]"
          style={{ fontFamily: previewFamily, fontSize: `${fontSize}px` }}
        >
          {t("fonts.previewText")}
        </div>
      </div>

      {/* Font size */}
      <div className="mb-6">
        <label className="mb-2 block text-sm font-medium text-[--color-fg]">
          {t("fonts.fontSize")}
          <span className="ml-2 text-xs text-[--color-fg-muted]">{fontSize}px</span>
        </label>
        <input
          type="range"
          min={MIN_FONT_SIZE}
          max={MAX_FONT_SIZE}
          value={fontSize}
          aria-label={t("fonts.fontSize")}
          onChange={(e) => setFontSize(Number(e.target.value))}
          className="w-64 accent-[--color-accent]"
        />
      </div>

      {/* Primary font */}
      <div className="mb-6">
        <label className="mb-2 block text-sm font-medium text-[--color-fg]">
          {t("fonts.primary")}
        </label>
        <select
          value={primaryFont}
          aria-label={t("fonts.primary")}
          onChange={(e) => setPrimaryFont(e.target.value)}
          className="w-72 rounded-lg border border-[--color-border] bg-[--color-bg] px-3 py-2 text-sm text-[--color-fg] outline-none focus:border-[--color-accent]"
        >
          <option value="">{t("fonts.systemDefault")}</option>
          {monospaceFonts.map((f) => (
            <option key={f.family} value={f.family}>
              {f.family}
            </option>
          ))}
        </select>
      </div>

      {/* CJK fallback */}
      <div className="mb-6">
        <label className="mb-2 block text-sm font-medium text-[--color-fg]">
          {t("fonts.cjkFallback")}
        </label>
        <select
          value={cjkFallbackFont}
          aria-label={t("fonts.cjkFallback")}
          onChange={(e) => setCjkFallbackFont(e.target.value)}
          className="w-72 rounded-lg border border-[--color-border] bg-[--color-bg] px-3 py-2 text-sm text-[--color-fg] outline-none focus:border-[--color-accent]"
        >
          <option value="">
            {t("fonts.autoDetect")}
            {report?.suggested_cjk_fallback
              ? ` (${report.suggested_cjk_fallback})`
              : ""}
          </option>
          {cjkFonts.map((f) => (
            <option key={f.family} value={f.family}>
              {f.family}
            </option>
          ))}
        </select>
      </div>

      {/* Missing-font hint + recommendations */}
      {missingCjk && (
        <div className="mb-4 flex gap-2 rounded-lg border border-[--color-warning]/40 bg-[--color-warning]/10 p-3 text-xs text-[--color-warning]">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>{t("fonts.missingHint")}</span>
        </div>
      )}

      <div>
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-[--color-fg-subtle]">
          {t("fonts.recommended")}
        </div>
        <ul className="flex flex-wrap gap-2">
          {(report?.recommended_cjk ?? []).map((name) => {
            const installed = cjkFonts.some((f) => f.family === name);
            return (
              <li
                key={name}
                className={`rounded-md border px-2.5 py-1 text-xs ${
                  installed
                    ? "border-[--color-success]/40 text-[--color-success]"
                    : "border-[--color-border] text-[--color-fg-muted]"
                }`}
              >
                {name}
                {installed ? " ✓" : ""}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
