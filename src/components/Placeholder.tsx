import { useTranslation } from "react-i18next";
import type { LucideIcon } from "lucide-react";

interface PlaceholderProps {
  icon: LucideIcon;
  titleKey: string;
}

export function Placeholder({ icon: Icon, titleKey }: PlaceholderProps) {
  const { t } = useTranslation();

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-[--color-fg-subtle]">
      <Icon size={48} strokeWidth={1} />
      <p className="text-sm font-medium text-[--color-fg-muted]">{t(titleKey)}</p>
      <p className="text-xs">{t("placeholder.comingSoon")}</p>
    </div>
  );
}
