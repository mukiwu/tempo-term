import { useState } from "react";
import { useTranslation } from "react-i18next";
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from "@/i18n/config";
import { useSettingsStore, type Theme } from "@/stores/settingsStore";
import { FontsSettingsSection } from "./FontsSettingsSection";

const THEMES: Theme[] = ["dark", "light"];
type SectionId = "appearance" | "fonts";
const SECTIONS: SectionId[] = ["appearance", "fonts"];

function AppearanceSection() {
  const { t } = useTranslation("settings");
  const language = useSettingsStore((s) => s.language);
  const setLanguage = useSettingsStore((s) => s.setLanguage);
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);

  return (
    <section>
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-[--color-fg-subtle]">
        {t("sections.appearance")}
      </h2>

      <div className="mb-6">
        <label className="mb-1 block text-sm font-medium text-[--color-fg]">
          {t("language.label")}
        </label>
        <p className="mb-2 text-xs text-[--color-fg-muted]">{t("language.description")}</p>
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
  );
}

export function SettingsView() {
  const { t } = useTranslation("settings");
  const [section, setSection] = useState<SectionId>("appearance");

  return (
    <div className="flex h-full">
      <nav className="w-48 shrink-0 border-r border-[--color-border] bg-[--color-bg-inset] p-3">
        <h1 className="mb-4 px-2 text-base font-semibold text-[--color-fg]">
          {t("title")}
        </h1>
        <ul className="space-y-0.5">
          {SECTIONS.map((id) => (
            <li key={id}>
              <button
                type="button"
                aria-current={section === id}
                onClick={() => setSection(id)}
                className={`w-full rounded-md px-3 py-2 text-left text-sm transition-colors ${
                  section === id
                    ? "bg-[--color-bg-elevated] text-[--color-fg]"
                    : "text-[--color-fg-muted] hover:bg-[--color-bg-elevated]/60"
                }`}
              >
                {t(`sections.${id}`)}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div className="min-w-0 flex-1 overflow-y-auto px-8 py-8">
        <div className="mx-auto max-w-2xl">
          {section === "appearance" ? <AppearanceSection /> : <FontsSettingsSection />}
        </div>
      </div>
    </div>
  );
}
