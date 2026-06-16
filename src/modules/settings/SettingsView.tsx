import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from "@/i18n/config";
import { useSettingsStore } from "@/stores/settingsStore";
import { THEMES } from "@/themes/themes";
import { FontsSettingsSection } from "./FontsSettingsSection";
import { AiSettingsSection } from "./AiSettingsSection";
import { ShortcutsSettingsSection } from "./ShortcutsSettingsSection";

type SectionId = "appearance" | "fonts" | "ai" | "shortcuts";
const SECTIONS: SectionId[] = ["appearance", "fonts", "ai", "shortcuts"];

function AppearanceSection() {
  const { t } = useTranslation("settings");
  const language = useSettingsStore((s) => s.language);
  const setLanguage = useSettingsStore((s) => s.setLanguage);
  const themeId = useSettingsStore((s) => s.themeId);
  const setThemeId = useSettingsStore((s) => s.setThemeId);

  return (
    <section>
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-fg-subtle">
        {t("sections.appearance")}
      </h2>

      <div className="mb-6">
        <label className="mb-1 block text-sm font-medium text-fg">
          {t("language.label")}
        </label>
        <p className="mb-2 text-xs text-fg-muted">{t("language.description")}</p>
        <div className="flex gap-2">
          {SUPPORTED_LANGUAGES.map((lng) => (
            <button
              key={lng}
              type="button"
              aria-pressed={language === lng}
              onClick={() => setLanguage(lng as SupportedLanguage)}
              className={`rounded-lg border px-4 py-2 text-sm transition-colors ${
                language === lng
                  ? "border-accent bg-bg-elevated text-fg"
                  : "border-border text-fg-muted hover:border-border-strong"
              }`}
            >
              {t(`language.${lng}`)}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium text-fg">
          {t("theme.label")}
        </label>
        <div className="grid grid-cols-2 gap-2">
          {THEMES.map((theme) => {
            const active = theme.id === themeId;
            return (
              <button
                key={theme.id}
                type="button"
                aria-pressed={active}
                onClick={() => setThemeId(theme.id)}
                className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                  active
                    ? "border-accent bg-bg-elevated"
                    : "border-border hover:border-border-strong"
                }`}
              >
                {/* Swatch preview built from the theme's own colours */}
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border"
                  style={{
                    backgroundColor: theme.colors.bg,
                    borderColor: theme.colors.border,
                  }}
                >
                  <span
                    className="h-3 w-3 rounded-full"
                    style={{ backgroundColor: theme.colors.accent }}
                  />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-fg">{theme.name}</span>
                  <span className="text-[11px] text-fg-subtle">
                    {t(`theme.${theme.appearance}`)}
                  </span>
                </span>
                {active && <Check size={15} className="shrink-0 text-accent" />}
              </button>
            );
          })}
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
      <nav className="w-48 shrink-0 border-r border-border bg-bg-inset p-3">
        <h1 className="mb-4 px-2 text-base font-semibold text-fg">
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
                    ? "bg-bg-elevated text-fg"
                    : "text-fg-muted hover:bg-bg-elevated/60"
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
          {section === "appearance" && <AppearanceSection />}
          {section === "fonts" && <FontsSettingsSection />}
          {section === "ai" && <AiSettingsSection />}
          {section === "shortcuts" && <ShortcutsSettingsSection />}
        </div>
      </div>
    </div>
  );
}
