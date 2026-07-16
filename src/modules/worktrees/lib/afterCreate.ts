import type { AgentKind } from "@/modules/claude-progress/lib/codexNormalize";

/** What each agent is called on the PATH. Bare — see the note below on why no
 *  initial prompt is passed. */
const AGENT_COMMAND: Record<AgentKind, string> = {
  claude: "claude",
  codex: "codex",
};

/**
 * The one line to run in a freshly created worktree's terminal, or null when
 * there is nothing to run.
 *
 * Written as a single line joined with `&&` rather than typed as two: an agent
 * that starts in a worktree where `pnpm install` just failed is worse than no
 * agent, because it begins working against a broken tree while the failure
 * scrolls away above it.
 *
 * **No initial prompt is passed to the agent**, deliberately. Passing one means
 * quoting arbitrary text for a shell we do not know: the pty runs a login shell
 * the user can override, and on Windows that is PowerShell or cmd.exe, which
 * escape quotes differently and share no safe form for free text. A prompt is
 * one paste away once the agent is up; a mangled one is a silent wrong answer.
 */
export function afterCreateCommand(options: {
  setupCommand?: string;
  agent?: AgentKind | null;
}): string | null {
  const setup = options.setupCommand?.trim();
  // The command goes into a live pty, where a newline submits. One hiding in the
  // field would run whatever follows as a command the user never saw as one.
  if (setup && /[\r\n]/.test(setup)) {
    return null;
  }
  const parts = [setup, options.agent ? AGENT_COMMAND[options.agent] : undefined].filter(
    (part): part is string => !!part,
  );
  return parts.length > 0 ? parts.join(" && ") : null;
}
