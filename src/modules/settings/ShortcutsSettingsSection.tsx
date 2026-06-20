import { useTranslation } from "react-i18next";
import { IS_MAC } from "@/lib/platform";
const MOD = IS_MAC ? "⌘" : "Ctrl";
const SHIFT = IS_MAC ? "⇧" : "Shift";
const ENTER = IS_MAC ? "↵" : "Enter";
const ALT = IS_MAC ? "⌥" : "Alt";
const DEL = IS_MAC ? "⌫" : "Backspace";

interface Shortcut {
  labelKey: string;
  keys: string;
}

interface ShortcutGroup {
  titleKey: string;
  items: Shortcut[];
}

const GROUPS: ShortcutGroup[] = [
  {
    titleKey: "shortcutsList.groups.general",
    items: [
      { labelKey: "shortcutsList.newTab", keys: `${MOD} T` },
      { labelKey: "shortcutsList.newTerminalTab", keys: `${MOD} ${SHIFT} T` },
      { labelKey: "shortcutsList.closeTab", keys: `${MOD} W` },
      { labelKey: "shortcutsList.findFiles", keys: `${MOD} P` },
      { labelKey: "shortcutsList.toggleSidebar", keys: `${MOD} B` },
      { labelKey: "shortcutsList.settings", keys: `${MOD} ,` },
    ],
  },
  {
    titleKey: "shortcutsList.groups.terminal",
    items: [
      { labelKey: "shortcutsList.splitRight", keys: `${MOD} D` },
      { labelKey: "shortcutsList.splitDown", keys: `${MOD} ${SHIFT} D` },
    ],
  },
  {
    titleKey: "shortcutsList.groups.terminalEdit",
    items: [
      { labelKey: "shortcutsList.lineStart", keys: `${MOD} ←` },
      { labelKey: "shortcutsList.lineEnd", keys: `${MOD} →` },
      { labelKey: "shortcutsList.wordBack", keys: `${ALT} ←` },
      { labelKey: "shortcutsList.wordForward", keys: `${ALT} →` },
      { labelKey: "shortcutsList.deleteToStart", keys: `${MOD} ${DEL}` },
      { labelKey: "shortcutsList.deleteWord", keys: `${ALT} ${DEL}` },
      { labelKey: "shortcutsList.killLine", keys: `${MOD} K` },
      { labelKey: "shortcutsList.newlineNoSubmit", keys: `${SHIFT} ${ENTER}` },
      { labelKey: "shortcutsList.copy", keys: `${MOD} C` },
      { labelKey: "shortcutsList.paste", keys: `${MOD} V` },
    ],
  },
  {
    titleKey: "shortcutsList.groups.editor",
    items: [{ labelKey: "shortcutsList.saveFile", keys: `${MOD} S` }],
  },
  {
    titleKey: "shortcutsList.groups.notes",
    items: [
      { labelKey: "shortcutsList.slashMenu", keys: "/" },
      { labelKey: "shortcutsList.exitCodeBlock", keys: `${MOD} ${ENTER}` },
    ],
  },
];

export function ShortcutsSettingsSection() {
  const { t } = useTranslation("settings");
  return (
    <section>
      <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-fg-subtle">
        {t("sections.shortcuts")}
      </h2>
      <p className="mb-6 text-xs text-fg-muted">{t("shortcutsList.description")}</p>

      <div className="columns-1 gap-x-10 md:columns-2 lg:columns-3">
        {GROUPS.map((group) => (
          <div key={group.titleKey} className="mb-6 break-inside-avoid">
            <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-fg-subtle">
              {t(group.titleKey)}
            </h3>
            <ul className="divide-y divide-border">
              {group.items.map((shortcut) => (
                <li
                  key={shortcut.labelKey}
                  className="flex items-center justify-between py-2 text-sm"
                >
                  <span className="text-fg-muted">{t(shortcut.labelKey)}</span>
                  <kbd className="shrink-0 rounded border border-border-strong bg-bg-inset px-2 py-0.5 font-mono text-xs text-fg">
                    {shortcut.keys}
                  </kbd>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
