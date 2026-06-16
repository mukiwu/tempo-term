import { useTranslation } from "react-i18next";
import { Search } from "lucide-react";

export function TitleBar() {
  const { t } = useTranslation();

  return (
    <header
      data-tauri-drag-region
      className="flex h-11 shrink-0 items-center gap-3 border-b border-[--color-border] bg-[--color-bg-inset] pl-20 pr-3"
    >
      <span className="text-sm font-semibold tracking-tight text-[--color-fg]">
        {t("appName")}
      </span>
      <span className="text-xs text-[--color-fg-subtle]">{t("tagline")}</span>

      <div className="ml-auto flex w-full max-w-md items-center gap-2 rounded-lg border border-[--color-border] bg-[--color-bg] px-3 py-1.5">
        <Search size={14} className="text-[--color-fg-subtle]" />
        <input
          type="text"
          placeholder={t("placeholder.search")}
          className="w-full bg-transparent text-xs text-[--color-fg] outline-none placeholder:text-[--color-fg-subtle]"
        />
      </div>
    </header>
  );
}
