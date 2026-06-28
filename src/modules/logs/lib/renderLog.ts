import { Terminal } from "@xterm/xterm";
import { getTheme } from "@/themes/themes";
import { selectTerminalFontFamily, useFontStore } from "@/stores/fontStore";
import { useSettingsStore } from "@/stores/settingsStore";

/** Trim leading/trailing blank lines and cap any interior run of blanks at 2. */
export function collapseBlankRuns(lines: string[]): string[] {
  const trimmed = [...lines];
  while (trimmed.length && trimmed[0] === "") trimmed.shift();
  while (trimmed.length && trimmed[trimmed.length - 1] === "") trimmed.pop();
  const out: string[] = [];
  let blankRun = 0;
  for (const line of trimmed) {
    if (line === "") {
      blankRun += 1;
      if (blankRun <= 2) out.push(line);
    } else {
      blankRun = 0;
      out.push(line);
    }
  }
  return out;
}

/**
 * Render raw PTY bytes (with ANSI control sequences) into the plain text a real
 * terminal would show, by feeding them through an off-DOM xterm and walking its
 * buffer once parsing settles. Sized wide so reflow doesn't truncate long
 * Claude/Codex transcripts.
 */
export async function renderLogToText(bytes: Uint8Array): Promise<string> {
  const host = document.createElement("div");
  host.style.cssText =
    "position:fixed;left:-99999px;top:-99999px;width:1600px;height:400px;visibility:hidden";
  document.body.appendChild(host);

  const font = useFontStore.getState();
  const term = new Terminal({
    cols: 200,
    rows: 50,
    // Clean-mode rendering caps at 100k scrollback lines; very large logs are
    // truncated at the top in this view. Raw mode shows everything via TextDecoder.
    scrollback: 100000,
    allowProposedApi: true,
    fontFamily: selectTerminalFontFamily(font),
    fontSize: font.fontSize,
    theme: getTheme(useSettingsStore.getState().themeId).terminal,
  });
  term.open(host);

  try {
    await new Promise<void>((resolve) => term.write(bytes, () => resolve()));
    const buf = term.buffer.active;
    const lines: string[] = [];
    for (let y = 0; y < buf.length; y++) {
      const line = buf.getLine(y);
      lines.push(line ? line.translateToString(true) : "");
    }
    return collapseBlankRuns(lines).join("\n");
  } finally {
    term.dispose();
    host.remove();
  }
}
