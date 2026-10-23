import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Search } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from "@/i18n/config";
import { IS_MAC } from "@/lib/platform";
import { LANGUAGE_AT_LAUNCH } from "@/lib/launchLanguage";
import { useSettingsStore } from "@/stores/settingsStore";
import { useUiStore } from "@/stores/uiStore";
import { getTheme, THEMES, type AppTheme } from "@/themes/themes";
import { FontsSettingsSection } from "./FontsSettingsSection";
import { TerminalSettingsSection } from "./TerminalSettingsSection";
import { AiSettingsSection } from "./AiSettingsSection";
import { WorkspaceSettingsSection } from "./WorkspaceSettingsSection";
import { GitGraphSettingsSection } from "./GitGraphSettingsSection";
import { SshSettingsSection } from "./SshSettingsSection";
import { ShortcutsSettingsSection } from "./ShortcutsSettingsSection";
import { AboutSettingsSection } from "./AboutSettingsSection";
import { BackgroundImageSettingsSection } from "./BackgroundImageSettingsSection";
import { searchSettings, type SettingsSearchEntry } from "./settingsSearch";

/** How long a setting found by the search stays highlighted. */
const SEARCH_HIGHLIGHT_MS = 1600;

const SECTIONS = [
  "appearance",
  "terminal",
  "ai",
  "workspace",
  "ssh",
  "gitGraph",
  "shortcuts",
  "about",
] as const;
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

  const previewThemeId = useUiStore((s) => s.previewThemeId);
  const setPreviewThemeId = useUiStore((s) => s.setPreviewThemeId);
  const previewTheme = getTheme(previewThemeId ?? themeId);

  // A preview never outlives the settings page.
  useEffect(() => () => setPreviewThemeId(null), [setPreviewThemeId]);
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
              onClick={() => {
                setLanguage(lng as SupportedLanguage);
                if (IS_MAC) {
                  // Keep the per-app AppleLanguages preference in step so the
                  // native menus (editor, notes) follow after a relaunch —
                  // AppKit only reads it at launch.
                  void invoke("set_app_languages", { languages: [lng] }).catch(() => {});
                }
              }}
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
        {IS_MAC && language !== LANGUAGE_AT_LAUNCH && (
          <p data-testid="language-restart-hint" className="mt-2 text-xs text-fg-muted">
            {t("language.restartHint")}
          </p>
        )}
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium text-fg">{t("theme.label")}</label>
        <ThemePreview theme={previewTheme} />
        {themeGroups.map((group) => (
          <div key={group.key} className="mt-3">
            <h4 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-fg-subtle">
              {t(`theme.${group.key}`)}
            </h4>
            <div
              className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4"
              // Leaving the grid ends the preview; moving between cards just
              // switches it.
              onMouseLeave={() => setPreviewThemeId(null)}
            >
              {group.themes.map((theme) => {
                const active = theme.id === themeId;
                const k = theme.terminal;
                return (
                  <button
                    key={theme.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => {
                      setThemeId(theme.id);
                      setPreviewThemeId(null);
                    }}
                    onMouseEnter={() => setPreviewThemeId(theme.id)}
                    onFocus={() => setPreviewThemeId(theme.id)}
                    onBlur={() => setPreviewThemeId(null)}
                    className={`overflow-hidden rounded-lg border text-left transition-colors ${
                      active ? "border-accent" : "border-border hover:border-border-strong"
                    }`}
                  >
                    <span
                      className="flex flex-col gap-1.5 px-2.5 py-2"
                      style={{ backgroundColor: k.background, color: k.foreground }}
                    >
                      <span className="text-xs font-medium">Aa</span>
                      <span className="flex gap-1" aria-hidden="true">
                        {[k.red, k.green, k.yellow, k.blue, k.magenta, k.cyan].map((color, i) => (
                          <span
                            key={i}
                            className="h-2 w-2 rounded-full"
                            style={{ backgroundColor: color }}
                          />
                        ))}
                      </span>
                    </span>
                    <span className="flex items-center gap-1 bg-bg-elevated px-2.5 py-1.5">
                      <span className="min-w-0 flex-1 truncate text-xs text-fg">{theme.name}</span>
                      <Check
                        size={13}
                        className={`shrink-0 text-accent ${active ? "" : "invisible"}`}
                      />
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-8 border-t border-border pt-8">
        <BackgroundImageSettingsSection />
      </div>

      {/* Font settings stay under Appearance; terminal behaviour now has its
          own top-level section in the sidebar. */}
      <div className="mt-8 border-t border-border pt-8">
        <FontsSettingsSection />
      </div>
    </section>
  );
}

/**
 * Finds the element that shows exactly `label` inside `root`: the innermost
 * one, so the highlight lands on the setting's own title rather than on the
 * whole section around it.
 */
function findLabelElement(root: HTMLElement, label: string): HTMLElement | null {
  const matches = (el: Element) => el.textContent?.trim() === label;
  let match = [...root.querySelectorAll<HTMLElement>("*")].find(matches) ?? null;
  while (match) {
    const child = [...match.children].find(matches) as HTMLElement | undefined;
    if (!child) {
      break;
    }
    match = child;
  }
  return match;
}

export function SettingsView() {
  const { t, i18n } = useTranslation("settings");
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<SettingsSearchEntry | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const highlightTimerRef = useRef<number | undefined>(undefined);
  const results = useMemo(
    () => searchSettings(query, t, i18n.getFixedT("en", "settings")),
    [query, t, i18n],
  );
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

  // After the chosen section renders, scroll the setting into view and
  // highlight it briefly.
  useEffect(() => {
    if (!pending || !contentRef.current) {
      return;
    }
    const el = findLabelElement(contentRef.current, t(pending.labelKey));
    setPending(null);
    if (!el) {
      return;
    }
    el.scrollIntoView?.({ block: "center" });
    el.classList.add("settings-search-hit");
    // Kept in a ref rather than cleaned up by this effect: clearing `pending`
    // above re-runs it, and that must not cancel the fade.
    window.clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = window.setTimeout(
      () => el.classList.remove("settings-search-hit"),
      SEARCH_HIGHLIGHT_MS,
    );
  }, [pending, section, t]);

  useEffect(() => () => window.clearTimeout(highlightTimerRef.current), []);

  function openResult(entry: SettingsSearchEntry) {
    setSection(entry.section);
    setPending(entry);
    setQuery("");
  }

  return (
    <div className="flex h-full w-full">
      <nav className="w-48 shrink-0 border-r border-border bg-bg-inset p-3">
        <h1 className="mb-3 px-2 text-base font-semibold text-fg">
          {t("title")}
        </h1>
        <div className="mb-3 flex items-center gap-1.5 rounded-md border border-border bg-bg px-2 py-1.5 focus-within:border-accent">
          <Search size={13} className="shrink-0 text-fg-subtle" />
          <input
            type="search"
            value={query}
            placeholder={t("search.placeholder")}
            aria-label={t("search.placeholder")}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || e.keyCode === 229) {
                return;
              }
              if (e.key === "Enter" && results[0]) {
                openResult(results[0]);
              } else if (e.key === "Escape" && query) {
                // Clear the search first; a second Escape closes the modal.
                e.stopPropagation();
                setQuery("");
              }
            }}
            className="w-full min-w-0 bg-transparent text-xs text-fg outline-none placeholder:text-fg-subtle"
          />
        </div>
        {query.trim() ? (
          results.length === 0 ? (
            <p className="px-2 text-xs text-fg-subtle">{t("search.noResults")}</p>
          ) : (
            <ul aria-label={t("search.results")} className="space-y-0.5">
              {results.map((entry) => (
                <li key={entry.labelKey}>
                  <button
                    type="button"
                    onClick={() => openResult(entry)}
                    className="w-full rounded-md px-2 py-1.5 text-left transition-colors hover:bg-bg-elevated/60"
                  >
                    <span className="block truncate text-sm text-fg">{t(entry.labelKey)}</span>
                    <span className="block truncate text-[11px] text-fg-subtle">
                      {t(`sections.${entry.section}`)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : (
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
        )}
      </nav>

      <div ref={contentRef} className="min-w-0 flex-1 overflow-y-auto px-8 py-8">
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
          {section === "ssh" && <SshSettingsSection />}
          {section === "gitGraph" && <GitGraphSettingsSection />}
          {section === "shortcuts" && <ShortcutsSettingsSection />}
          {section === "about" && <AboutSettingsSection />}
        </div>
      </div>
    </div>
  );
}
