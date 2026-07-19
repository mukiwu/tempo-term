import { useState } from "react";
import { PaneTabContent } from "@/modules/terminal/PaneTabContent";
import { LauncherPanel } from "@/components/LauncherPanel";
import { useTabsStore } from "@/stores/tabsStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { tabHasAutoResumeSession } from "@/modules/terminal/lib/autoResumeAiSession";

/**
 * The main work area. Every tab is a PaneTabContent (a splittable pane tree).
 *
 * Tabs mount lazily: only the active tab is mounted on first launch, so a
 * session restored with many tabs does not spawn every shell and read every
 * file at once. Once a tab has been activated it stays mounted (kept hidden
 * when inactive) so its terminals keep running for the rest of the session.
 *
 * When there is no active tab (a fresh launch, or after opening a new, empty
 * workspace) the launcher is shown as an overlay on top of the still-mounted
 * tabs — it must NOT replace the tab subtree, or every space's terminals would
 * unmount and their shells (e.g. a running Claude session) would be killed.
 */
export function TabsArea() {
  const tabs = useTabsStore((s) => s.tabs);
  const activeId = useTabsStore((s) => s.activeId);
  const autoResumeAiSessions = useSettingsStore((s) => s.autoResumeAiSessions);

  // Tab ids that have been activated at least once and should stay mounted.
  // Updating during render (not in an effect) lets React fold the new id into
  // this same render pass instead of an extra post-paint commit on every switch.
  const [mountedIds, setMountedIds] = useState<Set<string>>(
    () => new Set(activeId ? [activeId] : []),
  );
  const requiredIds = tabs
    .filter(
      (tab) =>
        tab.id === activeId ||
        (autoResumeAiSessions && tabHasAutoResumeSession(tab)),
    )
    .map((tab) => tab.id);
  if (requiredIds.some((id) => !mountedIds.has(id))) {
    setMountedIds((prev) => {
      const next = new Set(prev);
      requiredIds.forEach((id) => next.add(id));
      return next;
    });
  }

  return (
    <div className="relative h-full w-full bg-bg">
      {tabs.map((tab) => {
        // The active tab and every resumable AI tab mount immediately;
        // previously-visited tabs stay mounted. Other never-visited tabs remain
        // lazy so a large restored workspace does not spawn unrelated shells.
        const mount = tab.id === activeId || mountedIds.has(tab.id);
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

      {/* No active tab: overlay the launcher without unmounting the tabs behind
          it, so their terminal sessions keep running. */}
      {!activeId && (
        <div className="absolute inset-0">
          <LauncherPanel />
        </div>
      )}
    </div>
  );
}
