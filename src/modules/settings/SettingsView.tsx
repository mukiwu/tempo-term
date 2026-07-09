import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from "@/i18n/config";
import { useSettingsStore } from "@/stores/settingsStore";
import { useUiStore } from "@/stores/uiStore";
import { getTheme, THEMES, type AppTheme } from "@/themes/themes";
import { FontsSettingsSection } from "./FontsSettingsSection";
import { TerminalSettingsSection } from "./TerminalSettingsSection";
import { AiSettingsSection } from "./AiSettingsSection";
import { WorkspaceSettingsSection } from "./WorkspaceSettingsSection";
import { ShortcutsSettingsSection } from "./ShortcutsSettingsSection";
import { AboutSettingsSection } from "./AboutSettingsSection";

const SECTIONS = ["appearance", "terminal", "ai", "workspace", "shortcuts", "about"] as const;
type SectionId = typeof SECTIONS[number];

function isSectionId(value: string): value is SectionId {
  return (SECTIONS as readonly string[]).includes(value);
}

/**
 * A read-only code snippet painted in the active theme's own colours, so its
 * syntax palette stays visible. Clicking a theme swatch below applies it and
 * refreshes this preview.
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

  const previewTheme = getTheme(themeId);
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

      {/* Font settings stay under Appearance; terminal behaviour now has its
          own top-level section in the sidebar. */}
      <div className="mt-8 border-t border-border pt-8">
        <FontsSettingsSection />
      </div>
    </section>
  );
}

export function SettingsView() {
  const { t } = useTranslation("settings");
  // The modal unmounts SettingsView on close, so this lazy initializer re-runs
  // on every open: land on whatever section the menu bar / File > Settings
  // requested (e.g. Help > About), falling back to Appearance for a plain
  // open or an id that no longer exists.
  const [section, setSection] = useState<SectionId>(() => {
    const requested = useUiStore.getState().settingsSection;
    return requested && isSectionId(requested) ? requested : "appearance";
  });

  // Subscribe to the requested section reactively (not just at mount) so a
  // deep-link (e.g. Help > Keyboard Shortcuts) still switches the active
  // section while the modal is already open. Every non-null value is
  // consumed and cleared immediately after applying it, so a later plain
  // openSettings() / setSettingsOpen(true) bypass (Cmd+, or the gear icon)
  // never replays a stale section from an earlier deep-link.
  const requestedSection = useUiStore((s) => s.settingsSection);
  useEffect(() => {
    if (requestedSection === null) return;
    if (isSectionId(requestedSection)) {
      setSection(requestedSection);
    }
    useUiStore.setState({ settingsSection: null });
  }, [requestedSection]);

  return (
    <div className="flex h-full w-full">
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
            section === "shortcuts" || section === "appearance" || section === "about"
              ? ""
              : "mx-auto max-w-2xl"
          }
        >
          {section === "appearance" && <AppearanceSection />}
          {section === "terminal" && <TerminalSettingsSection />}
          {section === "ai" && <AiSettingsSection />}
          {section === "workspace" && <WorkspaceSettingsSection />}
          {section === "shortcuts" && <ShortcutsSettingsSection />}
          {section === "about" && <AboutSettingsSection />}
        </div>
      </div>
    </div>
  );
}
