import type { SessionAgent } from "./sessionsBridge";

/**
 * Pure resume command builder shared by the sessions browser and terminal
 * relaunch recovery.
 */

/** Session ids are UUID-like. Reject anything unsafe instead of shell-escaping it. */
const VALID_SESSION_ID = /^[A-Za-z0-9-]+$/;

/** Returns null for unsupported agents or a malformed session id. */
export function resumeCommand(agent: SessionAgent, sessionId: string): string | null {
  if (!VALID_SESSION_ID.test(sessionId)) {
    return null;
  }
  switch (agent) {
    case "claude":
      return `claude --resume ${sessionId}`;
    case "codex":
      return `codex resume ${sessionId}`;
    case "antigravity":
      return null;
  }
}
