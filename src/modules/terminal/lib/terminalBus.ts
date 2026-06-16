import { useTabsStore } from "@/stores/tabsStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";

type Writer = (text: string) => void;

const writers = new Map<string, Writer>();
const pending = new Map<string, string[]>();

/** A terminal pane registers how to write to its shell, keyed by its leaf id. */
export function registerTerminal(leafId: string, write: Writer): void {
  writers.set(leafId, write);
  const queued = pending.get(leafId);
  if (queued) {
    queued.forEach(write);
    pending.delete(leafId);
  }
}

export function unregisterTerminal(leafId: string): void {
  writers.delete(leafId);
}

/** Write to a specific pane, queueing until it registers (fresh PTYs). */
function writeToTerminal(leafId: string, text: string): void {
  const write = writers.get(leafId);
  if (write) {
    write(text);
  } else {
    const queue = pending.get(leafId) ?? [];
    queue.push(text);
    pending.set(leafId, queue);
  }
}

/**
 * Run a command in a terminal: reuse the active terminal tab if there is one,
 * otherwise the first terminal in the active space, otherwise open a new one.
 * The command is queued if the target pane's shell is still starting.
 */
export function runCommandInTerminal(command: string): void {
  const store = useTabsStore.getState();
  const active = store.tabs.find((t) => t.id === store.activeId);
  const tab =
    active && active.kind === "terminal"
      ? active
      : (store.tabs.find((t) => t.kind === "terminal" && t.spaceId === store.activeSpaceId) ??
        store.tabs.find((t) => t.kind === "terminal"));

  let leafId: string;
  if (tab && tab.kind === "terminal") {
    leafId = tab.activeLeafId;
    store.setActive(tab.id);
  } else {
    const root = useWorkspaceStore.getState().rootPath ?? undefined;
    store.newTerminalTab(root);
    const created = useTabsStore.getState().tabs.find(
      (t) => t.id === useTabsStore.getState().activeId,
    );
    if (!created || created.kind !== "terminal") {
      return;
    }
    leafId = created.activeLeafId;
  }

  writeToTerminal(leafId, command.endsWith("\n") ? command : `${command}\n`);
}
