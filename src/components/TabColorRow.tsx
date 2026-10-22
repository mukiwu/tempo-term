import { useTranslation } from "react-i18next";
import { Ban, Palette } from "lucide-react";
import { TAB_COLORS, useTabsStore, type Tab, type TabColor } from "@/stores/tabsStore";
import { TAB_COLOR_HEX } from "./tabColors";

/**
 * The color picker row at the top of a tab's context menu: no color plus the
 * eight swatches. The current choice gets a ring.
 */
export function TabColorRow({ tab, onPicked }: { tab: Tab; onPicked: () => void }) {
  const { t } = useTranslation();
  const setTabColor = useTabsStore((s) => s.setTabColor);

  function pick(color: TabColor | undefined) {
    setTabColor(tab.id, color);
    onPicked();
  }

  const ring = (selected: boolean) =>
    selected ? "outline-2 outline-offset-2 outline-fg-muted" : "";

  return (
    <div role="group" aria-label={t("actions.tabColor")} className="flex items-center gap-2.5 px-3 py-1.5">
      <Palette size={14} className="shrink-0 text-fg-muted" />
      <span className="mr-1 text-fg-muted">{t("actions.tabColor")}</span>
      <button
        type="button"
        aria-label={t("actions.noColor")}
        role="menuitemradio"
        aria-checked={!tab.color}
        onClick={() => pick(undefined)}
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-fg-subtle transition-[scale] active:scale-[0.96] ${ring(!tab.color)}`}
      >
        <Ban size={14} />
      </button>
      {TAB_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          aria-label={t(`actions.colors.${color}`)}
          role="menuitemradio"
          aria-checked={tab.color === color}
          onClick={() => pick(color)}
          style={{ background: TAB_COLOR_HEX[color] }}
          className={`h-4 w-4 shrink-0 rounded-full transition-[scale] active:scale-[0.96] ${ring(tab.color === color)}`}
        />
      ))}
    </div>
  );
}
