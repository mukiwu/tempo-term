import { useEffect } from "react";
import { TerminalTabBar } from "./TerminalTabBar";
import { TerminalView } from "./TerminalView";
import { useTerminalTabsStore } from "./store/terminalTabsStore";

export function TerminalWorkspace() {
  const tabs = useTerminalTabsStore((s) => s.tabs);
  const activeTabId = useTerminalTabsStore((s) => s.activeTabId);
  const addTab = useTerminalTabsStore((s) => s.addTab);
  const closeTab = useTerminalTabsStore((s) => s.closeTab);

  // Always keep one terminal open when this view is shown.
  useEffect(() => {
    if (tabs.length === 0) {
      addTab();
    }
  }, [tabs.length, addTab]);

  return (
    <div className="flex h-full flex-col bg-[--color-bg-inset]">
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
