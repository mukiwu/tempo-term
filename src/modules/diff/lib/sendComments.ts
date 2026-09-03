/**
 * Handing a review's comments to an agent. Both diff surfaces offer the same
 * button and the same menu of running sessions, and both send the whole batch:
 * comments are stored per file but sent together, so a review spread over
 * several files arrives as one prompt.
 */

import { SquareTerminal } from "lucide-react";
import type { ContextMenuItem } from "@/components/ContextMenu";
import { useTabsStore } from "@/stores/tabsStore";
import { useSessionStatusStore } from "@/modules/claude-progress/lib/sessionStatusStore";
import { pasteToTerminal } from "@/modules/terminal/lib/terminalBus";
import { useDiffCommentStore } from "./diffCommentStore";
import { formatCommentPrompt } from "./commentPrompt";
import { collectAgentTargets, type AgentTarget } from "./agentTargets";

/**
 * Send every unsent comment (across files) to the picked agent pane. The
 * prompt is pasted, not submitted: bracketed paste puts it in the agent's
 * input box so the user reviews and presses Enter there.
 */
export function sendCommentsToAgent(target: AgentTarget): void {
  const batch = useDiffCommentStore.getState().comments.filter((c) => !c.sent);
  if (batch.length === 0) {
    return;
  }
  pasteToTerminal(target.leafId, formatCommentPrompt(batch));
  useDiffCommentStore.getState().markSent(batch.map((c) => c.id));
  useTabsStore.getState().setActive(target.tabId);
}

/** The running agent sessions to offer, or one disabled row saying there are none. */
export function agentTargetMenuItems(noSessionLabel: string): ContextMenuItem[] {
  const targets = collectAgentTargets(
    useTabsStore.getState().tabs,
    useSessionStatusStore.getState().statuses,
    useSessionStatusStore.getState().agents,
  );
  if (targets.length === 0) {
    return [
      {
        id: "no-agent",
        label: noSessionLabel,
        icon: SquareTerminal,
        disabled: true,
        onSelect: () => {},
      },
    ];
  }
  return targets.map((target) => ({
    id: target.leafId,
    label: target.label,
    icon: SquareTerminal,
    onSelect: () => sendCommentsToAgent(target),
  }));
}
