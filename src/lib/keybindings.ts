import { IS_MAC, IS_WINDOWS } from "@/lib/platform";

/**
 * A key chord as stored in settings: modifiers in a fixed order followed by
 * the physical key's `KeyboardEvent.code`, for example `Mod+Shift+KeyP`.
 * `Mod` is the platform's primary modifier (Ctrl on Windows, Cmd elsewhere);
 * `Ctrl` only appears off Windows, where it is a separate key from Cmd.
 */
export type Chord = string;

/** A menu command whose shortcut the user can change. `id` is the menu item
 *  id in menuBarMenus.ts, which also supplies the command's action. */
export interface CustomizableShortcut {
  id: string;
  /** settings.json key of the command's name in the shortcuts list. */
  labelKey: string;
  defaults: { mac: Chord; win: Chord };
}

const same = (chord: Chord) => ({ mac: chord, win: chord });

export const CUSTOMIZABLE_SHORTCUTS: CustomizableShortcut[] = [
  { id: "command-palette", labelKey: "shortcutsList.commandPalette", defaults: same("Mod+KeyP") },
  { id: "find-files", labelKey: "shortcutsList.findFiles", defaults: same("Mod+Shift+KeyP") },
  { id: "new-terminal-tab", labelKey: "shortcutsList.newTerminalTab", defaults: same("Mod+KeyT") },
  {
    id: "new-window",
    labelKey: "shortcutsList.newWindow",
    defaults: { mac: "Mod+KeyN", win: "Mod+Shift+KeyN" },
  },
  { id: "close-tab", labelKey: "shortcutsList.closeTab", defaults: same("Mod+KeyW") },
  { id: "settings", labelKey: "shortcutsList.settings", defaults: same("Mod+Comma") },
  {
    id: "toggle-sidebar",
    labelKey: "shortcutsList.toggleSidebar",
    defaults: { mac: "Mod+KeyB", win: "Mod+Shift+KeyB" },
  },
  { id: "toggle-right-sidebar", labelKey: "shortcutsList.toggleRightSidebar", defaults: same("Mod+Alt+KeyB") },
  { id: "split-right", labelKey: "shortcutsList.splitRight", defaults: same("Mod+KeyD") },
  { id: "split-down", labelKey: "shortcutsList.splitDown", defaults: same("Mod+Shift+KeyD") },
  { id: "cycle-pane", labelKey: "shortcutsList.cyclePane", defaults: same("Mod+Backquote") },
  { id: "all-changes", labelKey: "shortcutsList.allChanges", defaults: same("Mod+Shift+KeyG") },
  { id: "reload-workspace", labelKey: "shortcutsList.reloadWorkspace", defaults: same("Mod+Shift+KeyR") },
];

/** Keys a chord may end in, with how each one is shown. */
const KEY_LABELS: Record<string, string> = {
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Space: "Space",
};

function keyLabel(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) {
    return code.slice(3);
  }
  if (/^Digit\d$/.test(code)) {
    return code.slice(5);
  }
  if (/^F([1-9]|1[0-2])$/.test(code)) {
    return code;
  }
  return KEY_LABELS[code] ?? null;
}

/**
 * The chord a keydown makes, or null when it cannot be a shortcut: a bare
 * modifier, a key outside the supported set, or a key with no Cmd, Ctrl or
 * Alt held (function keys excepted), which would steal ordinary typing.
 */
export function chordFromEvent(e: KeyboardEvent | React.KeyboardEvent): Chord | null {
  if (keyLabel(e.code) === null) {
    return null;
  }
  // Matches the app's own primary modifier (App.tsx): Ctrl on Windows, Cmd
  // everywhere else.
  const mod = IS_WINDOWS ? e.ctrlKey : e.metaKey;
  const ctrl = !IS_WINDOWS && e.ctrlKey;
  if (!mod && !ctrl && !e.altKey && !/^F\d+$/.test(e.code)) {
    return null;
  }
  // The Windows key is the system's, never an app shortcut.
  if (IS_WINDOWS && e.metaKey) {
    return null;
  }
  return [mod && "Mod", ctrl && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift", e.code]
    .filter(Boolean)
    .join("+");
}

/** How a chord reads: macOS glyphs (⌃⌥⇧⌘P) or Ctrl+Alt+Shift+P elsewhere. */
export function formatChord(chord: Chord): string {
  const parts = chord.split("+");
  const code = parts[parts.length - 1];
  const has = (token: string) => parts.includes(token);
  const key = keyLabel(code) ?? code;
  if (IS_MAC) {
    return `${has("Ctrl") ? "⌃" : ""}${has("Alt") ? "⌥" : ""}${has("Shift") ? "⇧" : ""}${
      has("Mod") ? "⌘" : ""
    }${key}`;
  }
  return [has("Mod") && "Ctrl", has("Alt") && "Alt", has("Shift") && "Shift", key]
    .filter(Boolean)
    .join("+");
}

/**
 * Chords that belong to something a user cannot reassign here: system and
 * Edit menu keys, Save, Find, zoom, tab and panel switching, Quit, Hide and
 * Minimize. Assigning one would leave two owners for the same keys.
 */
export function isReservedChord(chord: Chord): boolean {
  const parts = chord.split("+");
  const code = parts[parts.length - 1];
  const mods = parts.slice(0, -1).join("+");
  if (/^Digit\d$/.test(code) && (mods === "Mod" || mods === "Alt")) {
    return true;
  }
  const reserved = [
    "Mod+KeyQ",
    "Mod+KeyH",
    "Mod+KeyM",
    "Mod+KeyC",
    "Mod+KeyV",
    "Mod+KeyX",
    "Mod+KeyA",
    "Mod+KeyZ",
    "Mod+Shift+KeyZ",
    "Mod+KeyS",
    "Mod+KeyF",
    "Mod+Shift+KeyF",
    "Mod+KeyL",
    "Mod+Shift+KeyW",
    "Mod+BracketLeft",
    "Mod+BracketRight",
    "Mod+Equal",
    "Mod+Minus",
  ];
  return reserved.includes(chord);
}

export function defaultChord(shortcut: CustomizableShortcut): Chord {
  return IS_WINDOWS ? shortcut.defaults.win : shortcut.defaults.mac;
}

/** The chord a command answers to, with the user's override applied. */
export function effectiveChord(
  shortcut: CustomizableShortcut,
  overrides: Record<string, Chord>,
): Chord {
  return overrides[shortcut.id] ?? defaultChord(shortcut);
}

/** The command a chord is bound to, other than `exceptId`, for conflict
 *  warnings. */
export function findChordOwner(
  chord: Chord,
  overrides: Record<string, Chord>,
  exceptId?: string,
): CustomizableShortcut | undefined {
  return CUSTOMIZABLE_SHORTCUTS.find(
    (shortcut) => shortcut.id !== exceptId && effectiveChord(shortcut, overrides) === chord,
  );
}

export type KeybindingMatch =
  /** The chord is a user-assigned shortcut; run the command with this id. */
  | { kind: "run"; id: string }
  /** The chord is a default the user moved elsewhere; let the key through
   *  instead of running the built-in shortcut. */
  | { kind: "released" }
  | { kind: "none" };

/** What the app should do with a keydown, given the user's overrides. */
export function matchKeybinding(
  e: KeyboardEvent,
  overrides: Record<string, Chord>,
): KeybindingMatch {
  const chord = chordFromEvent(e);
  if (!chord || Object.keys(overrides).length === 0) {
    return { kind: "none" };
  }
  const owner = CUSTOMIZABLE_SHORTCUTS.find((shortcut) => overrides[shortcut.id] === chord);
  if (owner) {
    return { kind: "run", id: owner.id };
  }
  const released = CUSTOMIZABLE_SHORTCUTS.some(
    (shortcut) => shortcut.id in overrides && defaultChord(shortcut) === chord,
  );
  return released ? { kind: "released" } : { kind: "none" };
}
