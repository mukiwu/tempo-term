import { beforeEach, describe, expect, it } from "vitest";
import { useTerminalTabsStore } from "./terminalTabsStore";

function reset() {
  useTerminalTabsStore.setState({ tabs: [], activeTabId: null });
}

describe("terminalTabsStore", () => {
  beforeEach(reset);

  it("adds a tab, makes it active and returns its id", () => {
    const id = useTerminalTabsStore.getState().addTab();
    const { tabs, activeTabId } = useTerminalTabsStore.getState();
    expect(tabs).toHaveLength(1);
    expect(tabs[0].id).toBe(id);
    expect(activeTabId).toBe(id);
  });

  it("gives each tab a unique id", () => {
    const a = useTerminalTabsStore.getState().addTab();
    const b = useTerminalTabsStore.getState().addTab();
    expect(a).not.toBe(b);
    expect(useTerminalTabsStore.getState().tabs).toHaveLength(2);
  });

  it("activates the freshly added tab", () => {
    useTerminalTabsStore.getState().addTab();
    const second = useTerminalTabsStore.getState().addTab();
    expect(useTerminalTabsStore.getState().activeTabId).toBe(second);
  });

  it("falls back to a neighbouring tab when the active one closes", () => {
    const first = useTerminalTabsStore.getState().addTab();
    const second = useTerminalTabsStore.getState().addTab();
    useTerminalTabsStore.getState().closeTab(second);
    expect(useTerminalTabsStore.getState().activeTabId).toBe(first);
    expect(useTerminalTabsStore.getState().tabs).toHaveLength(1);
  });

  it("keeps the active tab unchanged when closing a different tab", () => {
    const first = useTerminalTabsStore.getState().addTab();
    const second = useTerminalTabsStore.getState().addTab();
    useTerminalTabsStore.getState().setActive(second);
    useTerminalTabsStore.getState().closeTab(first);
    expect(useTerminalTabsStore.getState().activeTabId).toBe(second);
  });

  it("clears the active tab when the last tab closes", () => {
    const only = useTerminalTabsStore.getState().addTab();
    useTerminalTabsStore.getState().closeTab(only);
    expect(useTerminalTabsStore.getState().activeTabId).toBeNull();
    expect(useTerminalTabsStore.getState().tabs).toHaveLength(0);
  });
});
