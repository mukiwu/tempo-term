import { useTranslation } from "react-i18next";
import {
  MAX_TERMINAL_PADDING,
  MIN_TERMINAL_PADDING,
  useSettingsStore,
} from "@/stores/settingsStore";
import { getTheme } from "@/themes/themes";

export function TerminalSettingsSection() {
  const { t } = useTranslation("settings");
  const terminalPadding = useSettingsStore((s) => s.terminalPadding);
  const setTerminalPadding = useSettingsStore((s) => s.setTerminalPadding);
  const themeId = useSettingsStore((s) => s.themeId);
  const terminal = getTheme(themeId).terminal;

  return (
    <section>
      <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-fg-subtle">
        {t("sections.terminal")}
      </h2>
      <p className="mb-6 text-xs text-fg-muted">{t("terminalSettings.description")}</p>

      <div className="mb-6">
        <label className="mb-2 block text-sm font-medium text-fg">
          {t("terminalSettings.padding")}
          <span className="ml-2 text-xs text-fg-muted">{terminalPadding}px</span>
        </label>
        <input
          type="range"
          min={MIN_TERMINAL_PADDING}
          max={MAX_TERMINAL_PADDING}
          value={terminalPadding}
          aria-label={t("terminalSettings.padding")}
          onChange={(e) => setTerminalPadding(Number(e.target.value))}
          className="w-64 accent-accent"
        />
      </div>

      {/* Live preview: an inner box inset by the chosen padding, in terminal colours */}
      <div>
        <div className="mb-2 text-xs text-fg-subtle">{t("terminalSettings.preview")}</div>
        <div
          className="overflow-hidden rounded-lg border border-border"
          style={{ backgroundColor: terminal.background, padding: terminalPadding }}
        >
          <pre
            className="m-0 font-mono text-xs leading-relaxed"
            style={{ color: terminal.foreground }}
          >
            {t("terminalSettings.previewText")}
          </pre>
        </div>
      </div>
    </section>
  );
}
