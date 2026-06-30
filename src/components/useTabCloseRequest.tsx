import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useEditorStore } from "@/modules/editor/store/editorStore";
import { useTabsStore, tabHasDirtyEditor, type Tab } from "@/stores/tabsStore";
import { ConfirmDialog } from "./ConfirmDialog";

interface TabCloseRequest {
  dirty: boolean;
  /** Trigger a close; pops the unsaved-changes dialog when the tab is dirty. */
  requestClose: () => void;
  /** Render this inside the consumer's tree so the confirm dialog can mount. */
  confirmCloseDialog: ReactNode;
}

/**
 * Shared close-request logic for tab surfaces (main TabBar and sidebar TabCard)
 * so they both honor the editor's unsaved-changes confirmation instead of one
 * silently dropping unsaved work.
 *
 * Accepts `Tab | undefined` so the caller can use the hook before its
 * `if (!tab) return null` guard without violating the rules of hooks.
 */
export function useTabCloseRequest(tab: Tab | undefined): TabCloseRequest {
  const { t } = useTranslation();
  const closeTab = useTabsStore((s) => s.closeTab);
  const dirty = useEditorStore((s) =>
    tab ? tabHasDirtyEditor(tab, s.buffers) : false,
  );
  const [confirmOpen, setConfirmOpen] = useState(false);

  const requestClose = () => {
    if (!tab) return;
    if (dirty) {
      setConfirmOpen(true);
    } else {
      closeTab(tab.id);
    }
  };

  // Portal the dialog so consumers can place {confirmCloseDialog} inside any
  // wrapper (e.g. the sidebar TabCard is a <button>) without producing invalid
  // <button>-inside-<button> markup.
  const confirmCloseDialog =
    confirmOpen && tab
      ? createPortal(
          <ConfirmDialog
            title={t("editor:closeUnsavedTitle")}
            message={t("editor:closeUnsavedMessage")}
            confirmLabel={t("editor:discardClose")}
            cancelLabel={t("actions.cancel")}
            onConfirm={() => {
              setConfirmOpen(false);
              closeTab(tab.id);
            }}
            onCancel={() => setConfirmOpen(false)}
          />,
          document.body,
        )
      : null;

  return { dirty, requestClose, confirmCloseDialog };
}
