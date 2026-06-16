import { useEffect, useRef } from "react";
import { TerminalTabBar } from "./TerminalTabBar";
import { TerminalView } from "./TerminalView";
import { useTerminalTabsStore } from "./store/terminalTabsStore";

export function TerminalWorkspace() {
  const tabs = useTerminalTabsStore((s) => s.tabs);
  const activeTabId = useTerminalTabsStore((s) => s.activeTabId);
  const addTab = useTerminalTabsStore((s) => s.addTab);
  const closeTab = useTerminalTabsStore((s) => s.closeTab);
  const initialized = useRef(false);

  // Open one terminal the first time the workspace shows. The ref guard keeps
  // React StrictMode's double-mount (dev) from creating two tabs. Afterwards
  // the user manages tabs with the + button.
  useEffect(() => {
    if (!initialized.current && useTerminalTabsStore.getState().tabs.length === 0) {
      initialized.current = true;
      addTab();
    }
  }, [addTab]);

  return (
    <div className="flex h-full flex-col bg-bg-inset">
      <TerminalTabBar />
      <div className="relative min-h-0 flex-1">
        {tabs.map((tab) => {
          const active = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              className={`absolute inset-0 p-2 ${active ? "" : "hidden"}`}
            >
              <TerminalView active={active} onExit={() => closeTab(tab.id)} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
