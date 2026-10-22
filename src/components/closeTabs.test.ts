import { beforeEach, describe, expect, it } from "vitest";
import { useTabsStore } from "@/stores/tabsStore";
import { closeTabsSafely, otherTabsOf, tabsRightOf } from "./closeTabs";

describe("closeTabsSafely", () => {
  beforeEach(() => {
    useTabsStore.setState({ tabs: [], activeId: null, spaces: [], activeSpaceId: null });
  });

  it("closes the other / right-hand tabs but leaves pinned ones open", () => {
    const s = useTabsStore.getState();
    const a = s.openPreviewTab("http://a.test");
    const b = s.openPreviewTab("http://b.test");
    const c = s.openPreviewTab("http://c.test");
    s.setTabPinned(c, true);
    // Order is now c (pinned), a, b.
    expect(tabsRightOf(a).map((t) => t.id)).toEqual([b]);

    closeTabsSafely(otherTabsOf(a));
    expect(useTabsStore.getState().tabs.map((t) => t.id)).toEqual([c, a]);
  });
});
