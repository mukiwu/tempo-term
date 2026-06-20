import type { ProgressEvent, TodoItem } from "./normalize";

export type ActivityStatus = "running" | "done" | "error";

export interface ToolActivity {
  id: string;
  name: string;
  status: ActivityStatus;
}

export const MAX_ACTIVITIES = 30;

export interface SubagentProgress {
  id: string;
  agentType: string;
  description: string;
  status: "running" | "done" | "failed";
  durationMs?: number;
  tokens?: number;
  toolUseCount?: number;
}

export interface ProgressState {
  activities: ToolActivity[];
  subagents: SubagentProgress[];
  todos: TodoItem[];
  idle: boolean;
}

export function emptyProgressState(): ProgressState {
  return { activities: [], subagents: [], todos: [], idle: false };
}

/**
 * Folds one normalized progress event into the accumulated state a UI renders.
 * Pure and immutable: callers thread the returned state into the next call.
 * "Activity" events (a tool or subagent starting, a todo update) clear the idle
 * flag; an explicit idle event sets it.
 */
export function reduceProgress(state: ProgressState, event: ProgressEvent): ProgressState {
  switch (event.kind) {
    case "tool:start": {
      const next = [
        ...state.activities,
        { id: event.id, name: event.name, status: "running" as const },
      ];
      const activities = next.length > MAX_ACTIVITIES ? next.slice(next.length - MAX_ACTIVITIES) : next;
      return { ...state, idle: false, activities };
    }
    case "tool:end": {
      const index = state.activities.findIndex(
        (activity) => activity.id === event.id && activity.status === "running",
      );
      if (index === -1) {
        return state;
      }
      const activities = state.activities.slice();
      activities[index] = { ...activities[index], status: event.ok ? "done" : "error" };
      return { ...state, activities };
    }
    case "subagent:start":
      return {
        ...state,
        idle: false,
        subagents: [
          ...state.subagents,
          {
            id: event.id,
            agentType: event.agentType,
            description: event.description,
            status: "running",
          },
        ],
      };
    case "subagent:end":
      return {
        ...state,
        subagents: state.subagents.map((sub) =>
          sub.id === event.id
            ? {
                ...sub,
                status: event.ok ? "done" : "failed",
                durationMs: event.durationMs,
                tokens: event.tokens,
                toolUseCount: event.toolUseCount,
              }
            : sub,
        ),
      };
    case "todo": {
      // Transcript appends often re-emit an unchanged todo list. Returning the
      // same reference when nothing changed lets the store short-circuit instead
      // of rewriting sessions and re-rendering on every append.
      if (state.idle === false && todosEqual(state.todos, event.items)) {
        return state;
      }
      return { ...state, idle: false, todos: event.items };
    }
    case "idle":
      if (state.idle) {
        return state;
      }
      return { ...state, idle: true };
    default:
      return state;
  }
}

/** True when two todo lists have the same items, in the same order, by content. */
function todosEqual(a: TodoItem[], b: TodoItem[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return a.every((item, index) => item.text === b[index].text && item.status === b[index].status);
}

/**
 * Tools that hand control back to the user and block until they answer, so a
 * session paused on one is waiting for input, not actively working. Claude Code
 * still records them as an unfinished tool_use in the transcript, which would
 * otherwise read as "active".
 */
const INTERACTIVE_TOOLS = new Set(["AskUserQuestion", "ExitPlanMode"]);

/**
 * The session's coarse state for the panel header: actively running a tool or
 * subagent, finished and waiting for input (idle), or thinking between actions.
 */
export function deriveStatus(progress: ProgressState): "active" | "thinking" | "idle" {
  const runningActivities = progress.activities.filter((activity) => activity.status === "running");
  // A pending interactive prompt blocks the turn on the user, so report it as
  // waiting for input even though the tool_use is technically still open.
  if (runningActivities.some((activity) => INTERACTIVE_TOOLS.has(activity.name))) {
    return "idle";
  }
  const running =
    runningActivities.length > 0 ||
    progress.subagents.some((subagent) => subagent.status === "running");
  if (running) {
    return "active";
  }
  if (progress.idle) {
    return "idle";
  }
  return "thinking";
}

export type { TodoItem };
