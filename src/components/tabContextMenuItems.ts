import { Pencil, X } from "lucide-react";
import type { TFunction } from "i18next";
import type { ContextMenuItem } from "./ContextMenu";

interface TabContextMenuActions {
  onRename: () => void;
  onClose: () => void;
}

/**
 * Shared item list for a tab's right-click menu. Used by both the main TabBar
 * and the sidebar workspace TabCard so the two surfaces stay in lockstep.
 */
export function tabContextMenuItems(
  t: TFunction,
  { onRename, onClose }: TabContextMenuActions,
): ContextMenuItem[] {
  return [
    {
      id: "rename",
      label: t("actions.renameTab"),
      icon: Pencil,
      group: 0,
      onSelect: onRename,
    },
    {
      id: "close",
      label: t("actions.closeTab"),
      icon: X,
      group: 1,
      danger: true,
      onSelect: onClose,
    },
  ];
}
