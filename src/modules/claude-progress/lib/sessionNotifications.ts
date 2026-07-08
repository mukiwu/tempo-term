import { getCurrentWindow } from "@tauri-apps/api/window";
import i18n from "@/i18n";
import { useSettingsStore } from "@/stores/settingsStore";
import type { Tab } from "@/stores/tabsStore";
import { useTabsStore } from "@/stores/tabsStore";
import { findPaneContent } from "@/modules/terminal/lib/terminalLayout";
import { basename } from "@/modules/explorer/lib/paths";
import { agentLabel } from "@/modules/workspace/lib/agentLabel";
import { selectCardTitle } from "@/modules/workspace/lib/cardTitle";
import { progressKey } from "./progressStore";
import { useTitlesStore } from "@/modules/workspace/lib/titlesStore";
import type { AgentKind } from "./codexNormalize";
import { useSessionStatusStore } from "./sessionStatusStore";
import type { SessionStatus } from "./sessionStatus";
import { notifyDesktop } from "./notify";

/** The kinds of OS notification a status transition can warrant. */
export type NotificationKind = "approval" | "done";

/**
 * Decide whether a per-pane status change should raise a desktop notification.
 *
 * - Entering `waiting-approval` (from anything else) → "approval": the agent is
 *   blocked on the user allowing a tool.
 * - Returning to `idle` from active work (`active`/`thinking`) → "done": the
 *   task just finished and is waiting for the next message. Crucially, the
 *   `SessionStart` idle (prev `undefined`) is NOT a finish, so it stays quiet.
 *
 * Re-emitting the same status (prev === next) never notifies, so a stream of
 * repeated `waiting-approval` events can't spam the user.
 */
export function notificationForTransition(
  prev: SessionStatus | undefined,
  next: SessionStatus | undefined,
): NotificationKind | null {
  if (next === "waiting-approval" && prev !== "waiting-approval") {
    return "approval";
  }
  if (next === "idle" && (prev === "active" || prev === "thinking")) {
    return "done";
  }
  return null;
}

/**
 * Resolve the label shown for a pane. A user rename of the tab always wins, so
 * the notification matches what the workspace card shows; otherwise the
 * auto-derived name is used: the session's transcript title if known, else the
 * cwd's directory name, else the tab's own title.
 */
export function resolvePaneLabel(
  tab: Pick<Tab, "renamed" | "title">,
  cwd: string | null,
  transcriptTitle: string | undefined,
): string {
  const autoTitle = transcriptTitle ?? (cwd ? basename(cwd) : undefined);
  return selectCardTitle(tab, autoTitle);
}

/**
 * A short label for the pane a notification is about. Searches the active
 * space's tabs for the leaf; returns "" when it can't be located.
 */
function leafContextName(leafId: string, agent: AgentKind | undefined): string {
  for (const tab of useTabsStore.getState().tabs) {
    const content = findPaneContent(tab.paneTree, leafId);
    if (!content || content.kind !== "terminal") {
      continue;
    }
    const cwd = content.cwd ?? tab.cwd ?? null;
    const transcriptTitle =
      cwd && agent ? useTitlesStore.getState().titles[progressKey(cwd, agent)] : undefined;
    return resolvePaneLabel(tab, cwd, transcriptTitle);
  }
  return "";
}

async function dispatch(
  leafId: string,
  kind: NotificationKind,
  agent: AgentKind | undefined,
): Promise<void> {
  try {
    // Only nudge the user when they're looking elsewhere; a focused window
    // already shows the live badge, so a system toast would just be noise.
    if (await getCurrentWindow().isFocused()) {
      return;
    }
    const label = agentLabel(agent) ?? i18n.t("notify.agentFallback");
    const title =
      kind === "approval"
        ? i18n.t("notify.needPermission", { agent: label })
        : i18n.t("notify.finished", { agent: label });
    await notifyDesktop(title, leafContextName(leafId, agent));
  } catch {
    // Best-effort: a missing window/permission must never break status updates.
  }
}

/**
 * Subscribe to the per-pane session status store and raise desktop
 * notifications on the transitions that warrant the user's attention. Returns
 * an unsubscribe function for an effect cleanup. No-op while the
 * `claudeNotifications` setting is off.
 */
export function installSessionNotifications(): () => void {
  return useSessionStatusStore.subscribe((state, prev) => {
    if (state.statuses === prev.statuses) {
      return; // An agent-only change; no status moved.
    }
    if (!useSettingsStore.getState().claudeNotifications) {
      return;
    }
    for (const leafId of Object.keys(state.statuses)) {
      const kind = notificationForTransition(prev.statuses[leafId], state.statuses[leafId]);
      if (kind) {
        void dispatch(leafId, kind, state.agents[leafId]);
      }
    }
  });
}
