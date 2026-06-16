import { useTranslation } from "react-i18next";
import { Circle } from "lucide-react";
import { LanguageSwitcher } from "./LanguageSwitcher";

export function StatusBar() {
  const { t } = useTranslation();

  return (
    <footer className="flex h-7 shrink-0 items-center gap-4 border-t border-[--color-border] bg-[--color-bg-inset] px-3 text-xs text-[--color-fg-muted]">
      <span className="flex items-center gap-1.5">
        <Circle size={8} className="fill-[--color-success] text-[--color-success]" />
        {t("statusBar.ready")}
      </span>
      <span>{t("statusBar.encoding")}</span>
      <div className="ml-auto">
        <LanguageSwitcher />
      </div>
    </footer>
  );
}
