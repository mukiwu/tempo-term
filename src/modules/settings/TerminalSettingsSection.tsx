import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  MAX_TERMINAL_PADDING,
  MIN_TERMINAL_PADDING,
  useSettingsStore,
} from "@/stores/settingsStore";
import { clearTerminalHistory } from "@/modules/terminal/lib/terminalHistory";
import { getTheme } from "@/themes/themes";

export function TerminalSettingsSection() {
  const { t } = useTranslation("settings");
  const terminalPadding = useSettingsStore((s) => s.terminalPadding);
  const setTerminalPadding = useSettingsStore((s) => s.setTerminalPadding);
  const restoreTerminalHistory = useSettingsStore((s) => s.restoreTerminalHistory);
  const setRestoreTerminalHistory = useSettingsStore((s) => s.setRestoreTerminalHistory);
  const terminalSuggestions = useSettingsStore((s) => s.terminalSuggestions);
  const setTerminalSuggestions = useSettingsStore((s) => s.setTerminalSuggestions);
  const themeId = useSettingsStore((s) => s.themeId);
  const terminal = getTheme(themeId).terminal;
  const [cleared, setCleared] = useState(false);

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

      {/* Live preview: an inner box inset by the chosen padding, in terminal
          colours. Sits right under the slider it previews. */}
      <div className="mb-6">
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

      <div className="mb-6">
        <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-fg">
          <input
            type="checkbox"
            checked={terminalSuggestions}
            onChange={(e) => setTerminalSuggestions(e.target.checked)}
            className="accent-accent"
          />
          {t("terminalSettings.suggestions")}
        </label>
        <p className="mt-1 text-xs text-fg-muted">{t("terminalSettings.suggestionsHint")}</p>
      </div>

      <div className="mb-6">
        <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-fg">
          <input
            type="checkbox"
            checked={restoreTerminalHistory}
            onChange={(e) => setRestoreTerminalHistory(e.target.checked)}
            className="accent-accent"
          />
          {t("terminalSettings.restoreHistory")}
        </label>
        <p className="mt-1 text-xs text-fg-muted">{t("terminalSettings.restoreHistoryHint")}</p>
        <button
          type="button"
          onClick={() => {
            void clearTerminalHistory().then(() => {
              setCleared(true);
              setTimeout(() => setCleared(false), 1500);
            });
          }}
          className="mt-3 rounded-md border border-border px-3 py-1.5 text-xs text-fg-muted transition-colors hover:bg-bg-elevated hover:text-fg"
        >
          {cleared ? t("terminalSettings.historyCleared") : t("terminalSettings.clearHistory")}
        </button>
      </div>
    </section>
  );
}
