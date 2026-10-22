import { beforeEach, describe, expect, it } from "vitest";
import { useTabsStore } from "@/stores/tabsStore";
import { useEditorStore } from "@/modules/editor/store/editorStore";
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

  it("leaves a tab with unsaved editor changes open", () => {
    const s = useTabsStore.getState();
    const keep = s.openPreviewTab("http://keep.test");
    const dirty = s.openEditorTab("/repo/dirty.ts");
    useEditorStore.setState({
      buffers: { "/repo/dirty.ts": { content: "changed", baseline: "original" } },
    } as never);

    closeTabsSafely(otherTabsOf(keep));
    expect(useTabsStore.getState().tabs.map((t) => t.id)).toEqual([keep, dirty]);
  });
});
