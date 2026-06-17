import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { Combobox } from "@/components/Combobox";
import {
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  selectTerminalFontFamily,
  useFontStore,
} from "@/stores/fontStore";

export function FontsSettingsSection() {
  const { t } = useTranslation("settings");
  const { primaryFont, fontSize, report, loading, setPrimaryFont, setFontSize, loadReport } =
    useFontStore();

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  const monospaceFonts = useMemo(
    () => (report?.fonts ?? []).filter((f) => f.monospace),
    [report],
  );

  const previewFamily = useFontStore(selectTerminalFontFamily);

  return (
    <section>
      <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-fg-subtle">
        {t("sections.fonts")}
      </h2>
      <p className="mb-6 text-xs text-fg-muted">{t("fonts.description")}</p>

      {loading && (
        <div className="mb-4 flex items-center gap-2 text-xs text-fg-muted">
          <Loader2 size={14} className="animate-spin" />
          {t("fonts.loading")}
        </div>
      )}

      {/* Live preview */}
      <div className="mb-6 rounded-lg border border-border bg-bg-inset p-4">
        <div className="mb-2 text-xs text-fg-subtle">{t("fonts.preview")}</div>
        <div
          className="text-fg"
          style={{ fontFamily: previewFamily, fontSize: `${fontSize}px` }}
        >
          {t("fonts.previewText")}
        </div>
      </div>

      {/* Font size */}
      <div className="mb-6">
        <label className="mb-2 block text-sm font-medium text-fg">
          {t("fonts.fontSize")}
          <span className="ml-2 text-xs text-fg-muted">{fontSize}px</span>
        </label>
        <input
          type="range"
          min={MIN_FONT_SIZE}
          max={MAX_FONT_SIZE}
          value={fontSize}
          aria-label={t("fonts.fontSize")}
          onChange={(e) => setFontSize(Number(e.target.value))}
          className="w-64 accent-accent"
        />
      </div>

      {/* Primary font */}
      <div>
        <label className="mb-2 block text-sm font-medium text-fg">
          {t("fonts.primary")}
        </label>
        <Combobox
          value={primaryFont || t("fonts.systemDefault")}
          options={[t("fonts.systemDefault"), ...monospaceFonts.map((f) => f.family)]}
          onChange={(value) =>
            setPrimaryFont(value === t("fonts.systemDefault") ? "" : value)
          }
          ariaLabel={t("fonts.primary")}
          className="w-72"
        />
      </div>
    </section>
  );
}
