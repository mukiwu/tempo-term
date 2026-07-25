import type { SessionAgent } from "./sessionsBridge";

/**
 * Pure resume command builder shared by the sessions browser and terminal
 * relaunch recovery.
 */

/** Session ids are UUID-like. Reject anything unsafe instead of shell-escaping it. */
const VALID_SESSION_ID = /^[A-Za-z0-9-]+$/;

/**
 * The launcher flags a resume command should carry under the user's settings:
 * the agent's launcher default flags when the resume-with-flags setting is
 * on, "" otherwise. Pure — callers hand in the settings slice.
 */
export function resumeFlagsFor(
  agent: string | undefined,
  settings: { resumeWithLauncherFlags: boolean; claudeFlags: string; codexFlags: string },
): string {
  if (!settings.resumeWithLauncherFlags) {
    return "";
  }
  if (agent === "claude") {
    return settings.claudeFlags;
  }
  if (agent === "codex") {
    return settings.codexFlags;
  }
  return "";
}

/**
 * Returns null for unsupported agents or a malformed session id. `flags` (the
 * user's launcher default flags, when the resume-with-flags setting is on) is
 * appended verbatim after the command; both CLIs accept their options after
 * the positional session id (verified against claude and codex resume --help).
 */
export function resumeCommand(
  agent: SessionAgent,
  sessionId: string,
  flags = "",
): string | null {
  if (!VALID_SESSION_ID.test(sessionId)) {
    return null;
  }
  // The command is submitted with a single trailing \r (see resume.ts); a
  // newline smuggled into the flags would split it into a second command.
  const extra = flags.replace(/[\r\n]+/g, " ").trim();
  const suffix = extra ? ` ${extra}` : "";
  switch (agent) {
    case "claude":
      return `claude --resume ${sessionId}${suffix}`;
    case "codex":
      return `codex resume ${sessionId}${suffix}`;
    case "antigravity":
      return null;
  }
}
