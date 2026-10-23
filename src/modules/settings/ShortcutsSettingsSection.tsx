import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { RotateCcw } from "lucide-react";
import {
  CUSTOMIZABLE_SHORTCUTS,
  chordFromEvent,
  defaultChord,
  effectiveChord,
  findChordOwner,
  formatChord,
  isReservedChord,
  type CustomizableShortcut,
} from "@/lib/keybindings";
import { useSettingsStore } from "@/stores/settingsStore";
import { useUiStore } from "@/stores/uiStore";
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
      { labelKey: "shortcutsList.switchTab", keys: `${MOD} 1–9` },
      { labelKey: "shortcutsList.switchSidebar", keys: `${ALT} 1–8` },
      { labelKey: "shortcutsList.zoomIn", keys: `${MOD} +` },
      { labelKey: "shortcutsList.zoomOut", keys: `${MOD} -` },
      { labelKey: "shortcutsList.resetZoom", keys: `${MOD} 0` },
    ],
  },
  {
    titleKey: "shortcutsList.groups.terminal",
    items: [
      {
        labelKey: "shortcutsList.searchTerminal",
        keys: IS_MAC ? `${MOD} F` : `${MOD} ${SHIFT} F`,
      },
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

/**
 * One command whose shortcut can be changed. Clicking the key records the
 * next chord pressed; Escape cancels, and a chord another command already
 * uses is refused with its name.
 */
function ShortcutRecorderRow({ shortcut }: { shortcut: CustomizableShortcut }) {
  const { t } = useTranslation("settings");
  const overrides = useSettingsStore((s) => s.keybindings);
  const setKeybinding = useSettingsStore((s) => s.setKeybinding);
  const [recording, setRecording] = useState(false);
  const [conflict, setConflict] = useState<string | null>(null);
  const chord = effectiveChord(shortcut, overrides);
  const changed = shortcut.id in overrides;

  // Listen on the window in the capture phase so the chord being recorded
  // never reaches the app's own shortcuts or the terminal.
  useEffect(() => {
    if (!recording) {
      return;
    }
    useUiStore.getState().setRecordingShortcut(true);
    function onKeyDown(e: KeyboardEvent) {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        setRecording(false);
        return;
      }
      const next = chordFromEvent(e);
      if (!next) {
        return;
      }
      if (isReservedChord(next)) {
        setConflict(t("shortcutsList.reserved"));
        return;
      }
      const owner = findChordOwner(next, overrides, shortcut.id);
      if (owner) {
        setConflict(t("shortcutsList.conflict", { name: t(owner.labelKey) }));
        return;
      }
      setKeybinding(shortcut.id, next === defaultChord(shortcut) ? null : next);
      setConflict(null);
      setRecording(false);
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      useUiStore.getState().setRecordingShortcut(false);
    };
  }, [recording, overrides, shortcut, setKeybinding, t]);

  return (
    <li className="py-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="text-fg-muted">{t(shortcut.labelKey)}</span>
        <span className="flex shrink-0 items-center gap-1">
          {changed && !recording && (
            <button
              type="button"
              aria-label={t("shortcutsList.reset", { name: t(shortcut.labelKey) })}
              title={t("shortcutsList.resetHint", { keys: formatChord(defaultChord(shortcut)) })}
              onClick={() => setKeybinding(shortcut.id, null)}
              className="rounded p-1 text-fg-subtle transition-colors hover:bg-bg-elevated hover:text-fg"
            >
              <RotateCcw size={12} />
            </button>
          )}
          <button
            type="button"
            aria-label={t("shortcutsList.record", { name: t(shortcut.labelKey) })}
            aria-pressed={recording}
            onClick={() => {
              setConflict(null);
              setRecording((value) => !value);
            }}
            onBlur={() => setRecording(false)}
            className={`rounded border px-2 py-0.5 font-mono text-xs transition-colors ${
              recording
                ? "border-accent bg-accent/15 text-accent"
                : changed
                  ? "border-accent/50 bg-bg-inset text-fg"
                  : "border-border-strong bg-bg-inset text-fg hover:border-accent/60"
            }`}
          >
            {recording ? t("shortcutsList.recording") : formatChord(chord)}
          </button>
        </span>
      </div>
      {conflict && recording && <p className="mt-1 text-xs text-danger">{conflict}</p>}
    </li>
  );
}

export function ShortcutsSettingsSection() {
  const { t } = useTranslation("settings");
  return (
    <section>
      <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-fg-subtle">
        {t("sections.shortcuts")}
      </h2>
      <p className="mb-6 text-xs text-fg-muted">{t("shortcutsList.description")}</p>

      <div className="columns-1 gap-x-10 md:columns-2 lg:columns-3">
        <div className="mb-6 break-inside-avoid">
          <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-fg-subtle">
            {t("shortcutsList.groups.customizable")}
          </h3>
          <p className="mb-1 text-xs text-fg-subtle">{t("shortcutsList.customizableHint")}</p>
          <ul className="divide-y divide-border">
            {CUSTOMIZABLE_SHORTCUTS.map((shortcut) => (
              <ShortcutRecorderRow key={shortcut.id} shortcut={shortcut} />
            ))}
          </ul>
        </div>
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
