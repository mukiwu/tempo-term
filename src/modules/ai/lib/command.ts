/** Languages we treat as a runnable shell command in a fenced code block. An
 * empty language tag (a bare ```) counts too, since the model often omits it. */
const SHELL_LANGS = new Set([
  "",
  "bash",
  "sh",
  "shell",
  "zsh",
  "console",
  "shell-session",
  "shellsession",
  "terminal",
]);

const FENCE = /```([\w-]*)\n([\s\S]*?)```/g;

/**
 * Pull the first shell command out of an assistant reply. Scans fenced code
 * blocks in order and returns the first one whose language looks like a shell,
 * trimmed. Returns null when no such block exists, so the caller can decide
 * whether to offer an "insert into terminal" action.
 */
export function extractCommand(markdown: string): string | null {
  FENCE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FENCE.exec(markdown)) !== null) {
    const lang = match[1].toLowerCase();
    if (SHELL_LANGS.has(lang)) {
      const body = match[2].trim();
      if (body.length > 0) {
        return body;
      }
    }
  }
  return null;
}

/**
 * Prepare a command for insertion into the terminal prompt: trim surrounding
 * whitespace (so no trailing newline auto-runs it) and drop a leading prompt
 * marker like "$ " or "% " the model may have copied in.
 */
export function sanitizeForInsertion(command: string): string {
  return command.trim().replace(/^[$%]\s+/u, "");
}
