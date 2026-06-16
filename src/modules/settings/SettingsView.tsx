import { useTranslation } from "react-i18next";
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from "@/i18n/config";
import { useSettingsStore, type Theme } from "@/stores/settingsStore";

const THEMES: Theme[] = ["dark", "light"];

export function SettingsView() {
  const { t } = useTranslation("settings");
  const language = useSettingsStore((s) => s.language);
  const setLanguage = useSettingsStore((s) => s.setLanguage);
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);

  return (
    <div className="mx-auto h-full w-full max-w-2xl overflow-y-auto px-8 py-10">
      <h1 className="mb-8 text-2xl font-semibold text-[--color-fg]">
        {t("title")}
      </h1>

      <section className="mb-10">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-[--color-fg-subtle]">
          {t("sections.appearance")}
        </h2>

        <div className="mb-6">
          <label className="mb-1 block text-sm font-medium text-[--color-fg]">
            {t("language.label")}
          </label>
          <p className="mb-2 text-xs text-[--color-fg-muted]">
            {t("language.description")}
          </p>
          <div className="flex gap-2">
            {SUPPORTED_LANGUAGES.map((lng) => (
              <button
                key={lng}
                type="button"
                aria-pressed={language === lng}
                onClick={() => setLanguage(lng as SupportedLanguage)}
                className={`rounded-lg border px-4 py-2 text-sm transition-colors ${
                  language === lng
                    ? "border-[--color-accent] bg-[--color-bg-elevated] text-[--color-fg]"
                    : "border-[--color-border] text-[--color-fg-muted] hover:border-[--color-border-strong]"
                }`}
              >
                {t(`language.${lng}`)}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium text-[--color-fg]">
            {t("theme.label")}
          </label>
          <div className="flex gap-2">
            {THEMES.map((th) => (
              <button
                key={th}
                type="button"
                aria-pressed={theme === th}
                onClick={() => setTheme(th)}
                className={`rounded-lg border px-4 py-2 text-sm transition-colors ${
                  theme === th
                    ? "border-[--color-accent] bg-[--color-bg-elevated] text-[--color-fg]"
                    : "border-[--color-border] text-[--color-fg-muted] hover:border-[--color-border-strong]"
                }`}
              >
                {t(`theme.${th}`)}
              </button>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
