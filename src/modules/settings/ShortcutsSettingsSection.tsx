import { useTranslation } from "react-i18next";

const IS_MAC =
  typeof navigator !== "undefined" && navigator.platform.toLowerCase().includes("mac");
const MOD = IS_MAC ? "⌘" : "Ctrl";

const SHORTCUTS: { labelKey: string; keys: string }[] = [
  { labelKey: "shortcutsList.newTab", keys: `${MOD} T` },
  { labelKey: "shortcutsList.findFiles", keys: `${MOD} P` },
  { labelKey: "shortcutsList.saveFile", keys: `${MOD} S` },
  { labelKey: "shortcutsList.sendMessage", keys: "Enter" },
];

export function ShortcutsSettingsSection() {
  const { t } = useTranslation("settings");
  return (
    <section>
      <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-fg-subtle">
        {t("sections.shortcuts")}
      </h2>
      <p className="mb-4 text-xs text-fg-muted">
        {t("shortcutsList.description")}
      </p>
      <ul className="divide-y divide-border">
        {SHORTCUTS.map((shortcut) => (
          <li
            key={shortcut.labelKey}
            className="flex items-center justify-between py-2.5 text-sm"
          >
            <span className="text-fg-muted">{t(shortcut.labelKey)}</span>
            <kbd className="rounded border border-border-strong bg-bg-inset px-2 py-0.5 font-mono text-xs text-fg">
              {shortcut.keys}
            </kbd>
          </li>
        ))}
      </ul>
    </section>
  );
}
