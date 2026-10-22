import { ChevronLeft, ChevronRight, Pencil, Pin, PinOff, X, XCircle } from "lucide-react";
import type { TFunction } from "i18next";
import { useTabsStore, type Tab } from "@/stores/tabsStore";
import type { ContextMenuItem } from "./ContextMenu";
import { closeTabsSafely, otherTabsOf, tabsRightOf } from "./closeTabs";

interface TabContextMenuActions {
  tab: Tab;
  onRename: () => void;
  onClose: () => void;
}

/**
 * Shared item list for a tab's right-click menu. Used by both the main TabBar
 * and the sidebar workspace TabCard so the two surfaces stay in lockstep.
 */
export function tabContextMenuItems(
  t: TFunction,
  { tab, onRename, onClose }: TabContextMenuActions,
): ContextMenuItem[] {
  const store = useTabsStore.getState();
  // Moves stay inside the tab's own group (pinned or not), so the ends of
  // that group disable the matching direction.
  const group = store.tabs.filter((x) => x.spaceId === tab.spaceId && !x.pinned === !tab.pinned);
  const index = group.findIndex((x) => x.id === tab.id);
  const others = otherTabsOf(tab.id).filter((x) => !x.pinned);
  const right = tabsRightOf(tab.id).filter((x) => !x.pinned);
  return [
    {
      id: "rename",
      label: t("actions.renameTab"),
      icon: Pencil,
      group: 0,
      onSelect: onRename,
    },
    {
      id: "pin",
      label: tab.pinned ? t("actions.unpinTab") : t("actions.pinTab"),
      icon: tab.pinned ? PinOff : Pin,
      group: 0,
      onSelect: () => store.setTabPinned(tab.id, !tab.pinned),
    },
    {
      id: "move-left",
      label: t("actions.moveTabLeft"),
      icon: ChevronLeft,
      group: 1,
      disabled: index <= 0,
      onSelect: () => store.moveTab(tab.id, -1),
    },
    {
      id: "move-right",
      label: t("actions.moveTabRight"),
      icon: ChevronRight,
      group: 1,
      disabled: index < 0 || index >= group.length - 1,
      onSelect: () => store.moveTab(tab.id, 1),
    },
    {
      id: "close-others",
      label: t("actions.closeOtherTabs"),
      icon: XCircle,
      group: 2,
      disabled: others.length === 0,
      onSelect: () => closeTabsSafely(others),
    },
    {
      id: "close-right",
      label: t("actions.closeTabsToRight"),
      icon: XCircle,
      group: 2,
      disabled: right.length === 0,
      onSelect: () => closeTabsSafely(right),
    },
    {
      id: "close",
      label: t("actions.closeTab"),
      icon: X,
      group: 3,
      danger: true,
      // A pinned tab has to be unpinned before it can be closed.
      disabled: tab.pinned,
      onSelect: onClose,
    },
  ];
}
