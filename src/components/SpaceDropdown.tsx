import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronRight } from "lucide-react";
import { useTabsStore } from "@/stores/tabsStore";

/**
 * A lightweight workspace switcher in the tab bar. Creating, renaming, and
 * deleting workspaces now live in the sidebar Workspaces panel; this dropdown
 * only switches between existing workspaces.
 */
export function SpaceDropdown() {
  const { t } = useTranslation();
  const spaces = useTabsStore((s) => s.spaces);
  const activeSpaceId = useTabsStore((s) => s.activeSpaceId);
  const setActiveSpace = useTabsStore((s) => s.setActiveSpace);

  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const activeSpace = spaces.find((s) => s.id === activeSpaceId);
  const label = activeSpace?.name ?? t("workspace.spaces");

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-7 items-center gap-1.5 rounded-md px-3 text-xs font-semibold text-fg transition-colors hover:bg-bg-elevated"
      >
        {label}
        <ChevronRight size={13} className={`transition-transform ${open ? "rotate-90" : ""}`} />
      </button>

      {open && (
        <div className="absolute left-0 top-9 z-50 w-64 overflow-hidden rounded-xl border border-border-strong bg-bg-elevated py-2 shadow-2xl">
          <div className="px-3 pb-1 text-[11px] font-bold uppercase tracking-wider text-fg-subtle">
            {t("workspace.spaces")}
          </div>

          {spaces.map((space) => {
            const active = space.id === activeSpaceId;
            return (
              <button
                key={space.id}
                type="button"
                onClick={() => {
                  setActiveSpace(space.id);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-bg ${
                  active ? "text-fg" : "text-fg-muted"
                }`}
              >
                <span
                  aria-hidden="true"
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-accent/20 text-[11px] font-bold text-accent"
                >
                  {space.name.charAt(0).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1 truncate font-medium">{space.name}</span>
                {active && <Check size={14} className="shrink-0 text-accent" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
