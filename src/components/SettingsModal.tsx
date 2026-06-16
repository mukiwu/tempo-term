import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { SettingsView } from "@/modules/settings/SettingsView";
import { useUiStore } from "@/stores/uiStore";

export function SettingsModal() {
  const { t } = useTranslation();
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6">
      <div className="relative flex h-[80vh] w-full max-w-4xl overflow-hidden rounded-xl border border-border-strong bg-bg shadow-2xl">
        <button
          type="button"
          aria-label={t("actions.cancel")}
          onClick={() => setSettingsOpen(false)}
          className="absolute right-3 top-3 z-10 rounded p-1 text-fg-muted hover:bg-bg-elevated hover:text-fg"
        >
          <X size={18} />
        </button>
        <SettingsView />
      </div>
    </div>
  );
}
