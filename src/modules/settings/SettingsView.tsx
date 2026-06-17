import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from "@/i18n/config";
import { useSettingsStore } from "@/stores/settingsStore";
import { getTheme, THEMES, type AppTheme } from "@/themes/themes";
import { FontsSettingsSection } from "./FontsSettingsSection";
import { TerminalSettingsSection } from "./TerminalSettingsSection";
import { AiSettingsSection } from "./AiSettingsSection";
import { ShortcutsSettingsSection } from "./ShortcutsSettingsSection";

type SectionId = "appearance" | "ai" | "shortcuts";
const SECTIONS: SectionId[] = ["appearance", "ai", "shortcuts"];

/**
 * A read-only code snippet painted in a theme's own colours, so the syntax
 * palette can be previewed before the theme is applied. Hovering a theme swatch
 * shows that theme here; otherwise it shows the active one.
 */
function ThemePreview({ theme }: { theme: AppTheme }) {
  const c = theme.colors;
  const k = theme.terminal;
  return (
    <div
      className="mb-3 overflow-x-auto rounded-lg border px-4 py-3 font-mono text-xs leading-relaxed"
      style={{ background: k.background, borderColor: c.border, color: c.fg }}
    >
      <div>
        <span style={{ color: k.magenta }}>const</span> theme{" "}
        <span style={{ color: k.cyan }}>=</span>{" "}
        <span style={{ color: k.blue }}>createTheme</span>({"{"}
      </div>
      <div>
        {"  "}
        <span style={{ color: k.red }}>name</span>:{" "}
        <span style={{ color: k.green }}>{`"${theme.name}"`}</span>,
      </div>
      <div>
        {"  "}
        <span style={{ color: k.red }}>accent</span>:{" "}
        <span style={{ color: k.green }}>{`"${c.accent}"`}</span>,
      </div>
      <div>
        {"  "}
        <span style={{ color: k.red }}>radius</span>: <span style={{ color: k.yellow }}>8</span>,
      </div>
      <div>{"})"}</div>
      <div style={{ color: c.fgSubtle }}>// applied across the workspace</div>
      <div>
        <span style={{ color: k.blue }}>applyTheme</span>(theme)
      </div>
    </div>
  );
}

function AppearanceSection() {
  const { t } = useTranslation("settings");
  const language = useSettingsStore((s) => s.language);
  const setLanguage = useSettingsStore((s) => s.setLanguage);
  const themeId = useSettingsStore((s) => s.themeId);
  const setThemeId = useSettingsStore((s) => s.setThemeId);
  const [hoveredTheme, setHoveredTheme] = useState<string | null>(null);

  const previewTheme = getTheme(hoveredTheme ?? themeId);
  const themeGroups = [
    { key: "light", themes: THEMES.filter((theme) => theme.appearance === "light") },
    { key: "dark", themes: THEMES.filter((theme) => theme.appearance === "dark") },
  ] as const;

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
              className={`rounded-md border px-3 py-1.5 text-xs transition-colors ${
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
        <label className="mb-2 block text-sm font-medium text-fg">{t("theme.label")}</label>
        <ThemePreview theme={previewTheme} />
        {themeGroups.map((group) => (
          <div key={group.key} className="mt-3">
            <h4 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-fg-subtle">
              {t(`theme.${group.key}`)}
            </h4>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-4">
              {group.themes.map((theme) => {
                const active = theme.id === themeId;
                return (
                  <button
                    key={theme.id}
                    type="button"
                    aria-pressed={active}
                    onMouseEnter={() => setHoveredTheme(theme.id)}
                    onMouseLeave={() => setHoveredTheme(null)}
                    onClick={() => setThemeId(theme.id)}
                    className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-colors ${
                      active
                        ? "border-accent bg-bg-elevated"
                        : "border-border hover:border-border-strong"
                    }`}
                  >
                    <span
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded border"
                      style={{
                        backgroundColor: theme.colors.bg,
                        borderColor: theme.colors.border,
                      }}
                    >
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: theme.colors.accent }}
                      />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs text-fg">{theme.name}</span>
                    <Check
                      size={13}
                      className={`shrink-0 text-accent ${active ? "" : "invisible"}`}
                    />
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Fonts and terminal display settings now live under Appearance so the
          sidebar stays a short list of top-level areas. */}
      <div className="mt-8 border-t border-border pt-8">
        <FontsSettingsSection />
      </div>

      <div className="mt-8 border-t border-border pt-8">
        <TerminalSettingsSection />
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
        {/* Shortcuts read better edge-to-edge; the rest stay in a reading column */}
        <div
          className={
            section === "shortcuts" || section === "appearance" ? "" : "mx-auto max-w-2xl"
          }
        >
          {section === "appearance" && <AppearanceSection />}
          {section === "ai" && <AiSettingsSection />}
          {section === "shortcuts" && <ShortcutsSettingsSection />}
        </div>
      </div>
    </div>
  );
}
