import type { SessionAgent } from "./sessionsBridge";

/** Badge color per agent, reusing the theme's existing semantic color
 *  tokens — none of these are agent-specific, they're just distinct enough
 *  to tell the three badges apart at a glance. Display labels live in i18n
 *  under `sessions.agents.*`. Shared by the sidebar panel and the transcript
 *  tab so both badges stay visually identical. */
export const AGENT_BADGE_CLASS: Record<SessionAgent, string> = {
  claude: "text-accent",
  codex: "text-fg-subtle",
  antigravity: "text-warning",
};

/** `AGENT_BADGE_CLASS` lookup for a value that may not be a known agent yet
 *  (e.g. a live session's agent, which is a plain `string | undefined` — see
 *  liveSessions.ts — because the foreground poll that classifies a pane can
 *  lag its status). Falls back to the muted default badge color. */
export function agentBadgeClass(agent: string | undefined): string {
  return agent && agent in AGENT_BADGE_CLASS
    ? AGENT_BADGE_CLASS[agent as SessionAgent]
    : "text-fg-subtle";
}
