/**
 * Serializes the frontend menu tree (menuBarMenus.ts) into the model the Rust
 * `set_native_menu` command consumes to rebuild the native macOS menu bar.
 * macOS-only path; Windows keeps the in-window WindowMenuBar untouched.
 */

const MOD_GLYPHS: Record<string, string> = {
  "⌘": "Cmd",
  "⇧": "Shift",
  "⌥": "Alt",
  "⌃": "Ctrl",
};

// muda's accelerator parser has no Plus token, so the zoom-in glyph must map
// to Equal (menu shows ⌘=, same as Chrome / VSCode).
const KEY_MAP: Record<string, string> = { "+": "Equal" };

export function macShortcutToAccelerator(mac: string): string {
  const mods: string[] = [];
  let key = "";
  for (const ch of [...mac]) {
    const mod = MOD_GLYPHS[ch];
    if (mod) mods.push(mod);
    else key += ch;
  }
  if (!key) return "";
  return [...mods, KEY_MAP[key] ?? key.toUpperCase()].join("+");
}
