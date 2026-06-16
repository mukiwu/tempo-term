import { useTranslation } from "react-i18next";
import { Languages } from "lucide-react";
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from "@/i18n/config";
import { useSettingsStore } from "@/stores/settingsStore";

export function LanguageSwitcher() {
  const { t } = useTranslation("settings");
  const language = useSettingsStore((s) => s.language);
  const setLanguage = useSettingsStore((s) => s.setLanguage);

  return (
    <label className="flex items-center gap-1.5 text-[--color-fg-muted] hover:text-[--color-fg]">
      <Languages size={13} />
      <select
        aria-label={t("language.label")}
        value={language}
        onChange={(e) => setLanguage(e.target.value as SupportedLanguage)}
        className="cursor-pointer bg-transparent text-xs outline-none"
      >
        {SUPPORTED_LANGUAGES.map((lng) => (
          <option key={lng} value={lng} className="bg-[--color-bg-elevated]">
            {t(`language.${lng}`)}
          </option>
        ))}
      </select>
    </label>
  );
}
