import { useEffect, useRef, useState } from "react";
import { PaneTabContent } from "@/modules/terminal/PaneTabContent";
import { LauncherPanel } from "@/components/LauncherPanel";
import { useTabsStore } from "@/stores/tabsStore";

/**
 * The main work area. Every tab is a PaneTabContent (a splittable pane tree).
 *
 * Tabs mount lazily: only the active tab is mounted on first launch, so a
 * session restored with many tabs does not spawn every shell and read every
 * file at once. Once a tab has been activated it stays mounted (kept hidden
 * when inactive) so its terminals keep running for the rest of the session.
 * With no tabs at all, the launcher takes over the whole area.
 */
export function TabsArea() {
  const tabs = useTabsStore((s) => s.tabs);
  const activeId = useTabsStore((s) => s.activeId);

  // Tab ids that have been activated at least once and should stay mounted.
  const mountedRef = useRef<Set<string>>(new Set());
  const [, forceRender] = useState(0);

  useEffect(() => {
    if (activeId && !mountedRef.current.has(activeId)) {
      mountedRef.current.add(activeId);
      forceRender((n) => n + 1);
    }
  }, [activeId]);

  if (!activeId) {
    return <LauncherPanel />;
  }

  return (
    <div className="relative h-full w-full bg-bg">
      {tabs.map((tab) => {
        // The active tab always mounts immediately; previously-visited tabs
        // stay mounted; never-visited tabs render nothing until activated.
        const mount = tab.id === activeId || mountedRef.current.has(tab.id);
        return (
          <div
            key={tab.id}
            className={`absolute inset-0 ${tab.id === activeId ? "" : "hidden"}`}
          >
            {mount &&
              (tab.kind === "launcher" ? (
                <LauncherPanel target={{ mode: "newTab", closeTabId: tab.id }} />
              ) : (
                <PaneTabContent tab={tab} />
              ))}
          </div>
        );
      })}
    </div>
  );
}
