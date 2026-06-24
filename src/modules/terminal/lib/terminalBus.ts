import { useTabsStore } from "@/stores/tabsStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { formatPathsForTerminal } from "./terminalClipboard";

type Writer = (text: string) => void;
type Reader = () => string;
type PathDropHandler = (paths: string[]) => boolean | Promise<boolean>;

const writers = new Map<string, Writer>();
const readers = new Map<string, Reader>();
const pathDropHandlers = new Map<string, PathDropHandler>();
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

/** A terminal pane registers how to read its current scrollback as plain text. */
export function registerTerminalReader(leafId: string, read: Reader): void {
  readers.set(leafId, read);
}

export function unregisterTerminalReader(leafId: string): void {
  readers.delete(leafId);
}

/** Read a specific pane's scrollback, or null if it has no reader registered. */
export function readTerminalBuffer(leafId: string): string | null {
  const read = readers.get(leafId);
  return read ? read() : null;
}

export function registerTerminalPathDrop(leafId: string, drop: PathDropHandler): void {
  pathDropHandlers.set(leafId, drop);
}

export function unregisterTerminalPathDrop(leafId: string): void {
  pathDropHandlers.delete(leafId);
}

/** Write to a specific pane, queueing until it registers (fresh PTYs). */
export function writeToTerminal(leafId: string, text: string): void {
  const write = writers.get(leafId);
  if (write) {
    write(text);
  } else {
    const queue = pending.get(leafId) ?? [];
    queue.push(text);
    pending.set(leafId, queue);
  }
}

/** Drop file/folder paths into a terminal pane, letting it decide CLI-specific behavior. */
export function dropPathsIntoTerminal(leafId: string, paths: string[]): boolean {
  const drop = pathDropHandlers.get(leafId);
  if (!drop) {
    return false;
  }
  const fallback = () => writeToTerminal(leafId, formatPathsForTerminal(paths));
  try {
    const handled = drop(paths);
    if (handled instanceof Promise) {
      handled.then((ok) => {
        if (!ok) {
          fallback();
        }
      });
    } else if (!handled) {
      fallback();
    }
  } catch {
    fallback();
  }
  return true;
}

/**
 * Resolve the terminal pane to target: the active terminal tab if there is one,
 * otherwise the first terminal in the active space, otherwise the first terminal
 * anywhere. Returns the owning tab id and its active leaf id, or null when no
 * terminal exists. Pure lookup — callers decide whether to focus the tab, since
 * reading for context should not yank the user to another tab.
 */
function resolveActiveTerminal(): { tabId: string; leafId: string } | null {
  const store = useTabsStore.getState();
  const active = store.tabs.find((t) => t.id === store.activeId);
  const tab =
    active && active.kind === "terminal"
      ? active
      : (store.tabs.find((t) => t.kind === "terminal" && t.spaceId === store.activeSpaceId) ??
        store.tabs.find((t) => t.kind === "terminal"));
  if (!tab || tab.kind !== "terminal") {
    return null;
  }
  return { tabId: tab.id, leafId: tab.activeLeafId };
}

/**
 * Run a command in a terminal: reuse the active terminal tab if there is one,
 * otherwise the first terminal in the active space, otherwise open a new one.
 * The command is queued if the target pane's shell is still starting.
 */
export function runCommandInTerminal(command: string): void {
  const resolved = resolveActiveTerminal();
  let leafId: string;
  if (resolved) {
    leafId = resolved.leafId;
    useTabsStore.getState().setActive(resolved.tabId);
  } else {
    const root = useWorkspaceStore.getState().rootPath ?? undefined;
    useTabsStore.getState().newTerminalTab(root);
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

/** Read the active terminal's scrollback as plain text, or null if there is
 * none. Does not change the active tab — it only reads for context. */
export function readActiveTerminalBuffer(): string | null {
  const resolved = resolveActiveTerminal();
  return resolved ? readTerminalBuffer(resolved.leafId) : null;
}

/**
 * Insert text into the active terminal's prompt WITHOUT running it (no trailing
 * newline), so the user can review and press Enter themselves. Focuses the
 * terminal so the inserted text is visible. Returns false when there is no
 * terminal to insert into.
 */
export function insertIntoActiveTerminal(text: string): boolean {
  const resolved = resolveActiveTerminal();
  if (!resolved) {
    return false;
  }
  useTabsStore.getState().setActive(resolved.tabId);
  writeToTerminal(resolved.leafId, text);
  return true;
}
