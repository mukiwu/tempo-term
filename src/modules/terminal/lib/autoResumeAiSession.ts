import type { AiSessionBinding } from "./terminalLayout";
import type { Tab } from "@/stores/tabsStore";
import { computeLayout } from "./terminalLayout";
import { resumeCommand } from "@/modules/sessions/lib/resumeCommand";

// Process-local guard: persisted bindings survive relaunch, but a React remount
// in the same app process must never attach to the same conversation twice.
const attempted = new Set<string>();

function attemptKey(leafId: string, session: AiSessionBinding): string {
  return `${leafId}\0${session.agent}\0${session.sessionId}`;
}

/**
 * Return the exact resume command once per pane/session in this app process.
 * Invalid ids are never marked attempted, so fixing persisted data can recover.
 */
export function takeAutoResumeCommand(
  leafId: string | undefined,
  session: AiSessionBinding | undefined,
  enabled: boolean,
): string | null {
  if (!enabled || !leafId || !session) {
    return null;
  }
  const command = resumeCommand(session.agent, session.sessionId);
  if (!command) {
    return null;
  }
  const key = attemptKey(leafId, session);
  if (attempted.has(key)) {
    return null;
  }
  attempted.add(key);
  return command;
}

/** Release a claim that was torn down before its command reached a live PTY. */
export function releaseAutoResumeAttempt(
  leafId: string | undefined,
  session: AiSessionBinding | undefined,
): void {
  if (leafId && session) {
    attempted.delete(attemptKey(leafId, session));
  }
}

/** Ignore a delayed SessionEnd from a conversation this pane already replaced. */
export function sessionEndMatchesBinding(
  current: AiSessionBinding | undefined,
  sessionId: string | null | undefined,
  agent: AiSessionBinding["agent"] | null | undefined,
): boolean {
  return (
    !current ||
    !sessionId ||
    (current.sessionId === sessionId && (!agent || current.agent === agent))
  );
}

/** Whether a tab contains at least one local conversation eligible for resume. */
export function tabHasAutoResumeSession(tab: Tab): boolean {
  return computeLayout(tab.paneTree).some(
    (pane) =>
      pane.content.kind === "terminal" &&
      !pane.content.ssh &&
      Boolean(pane.content.aiSession),
  );
}

/** Test-only reset for the process-local attempt guard. */
export function resetAutoResumeAttempts(): void {
  attempted.clear();
}
