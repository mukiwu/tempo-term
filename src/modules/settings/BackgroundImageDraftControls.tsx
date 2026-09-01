import { useTranslation } from "react-i18next";
import {
  MAX_BACKGROUND_IMAGE_OPACITY,
  MIN_BACKGROUND_IMAGE_OPACITY,
  type BackgroundImageScope,
} from "@/stores/settingsStore";
import { useBackgroundImageDraftStore } from "@/stores/backgroundImageDraftStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { getTheme } from "@/themes/themes";

export function BackgroundImageDraftControls({
  compact = false,
  columns = false,
}: {
  compact?: boolean;
  /** Two-column grid used by the settings section's full-width layout; the
   *  preview panel keeps the single vertical stack. */
  columns?: boolean;
}) {
  const { t } = useTranslation("settings");
  const draft = useBackgroundImageDraftStore((state) => state.draft);
  const update = useBackgroundImageDraftStore((state) => state.update);
  const themeId = useSettingsStore((state) => state.themeId);

  if (!draft) return null;

  const disabled = !draft.path || draft.imageFailed;
  const scopeOptions: BackgroundImageScope[] = ["workspace", "window"];
  const sectionLayout = columns
    ? "grid gap-x-8 gap-y-5 sm:grid-cols-2"
    : compact
      ? "space-y-4"
      : "space-y-5";

  return (
    <div className={sectionLayout}>
      <div>
        <label className="mb-2 block text-xs font-medium text-fg">
          {t("background.scopeLabel")}
        </label>
        <div className="grid grid-cols-2 rounded-lg border border-border bg-bg-inset p-1">
          {scopeOptions.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={draft.scope === option}
              disabled={disabled}
              onClick={() => update({ scope: option })}
              className={`rounded-md px-2 py-1.5 text-xs transition-[background-color,color,transform] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 ${
                draft.scope === option
                  ? "bg-bg-elevated text-fg shadow-sm"
                  : "text-fg-muted hover:text-fg"
              }`}
            >
              {t(`background.scope.${option}`)}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label
          htmlFor={compact ? "preview-background-text-color" : "background-image-text-color"}
          className="mb-2 block text-xs font-medium text-fg"
        >
          {t("background.textColor")}
        </label>
        <div className="flex items-center gap-2">
          <input
            id={compact ? "preview-background-text-color" : "background-image-text-color"}
            type="color"
            value={draft.textColor ?? getTheme(themeId).colors.fg}
            disabled={disabled}
            onChange={(event) => update({ textColor: event.currentTarget.value })}
            className="h-9 w-12 cursor-pointer rounded-md border border-border bg-bg-inset p-1 disabled:cursor-not-allowed disabled:opacity-40"
          />
          <output className="min-w-20 font-mono text-[11px] text-fg-muted">
            {draft.textColor ?? t("background.textColorTheme")}
          </output>
          <button
            type="button"
            disabled={disabled || draft.textColor === null}
            onClick={() => update({ textColor: null })}
            className="ml-auto rounded-md border border-border px-2.5 py-1.5 text-xs text-fg-muted transition-colors hover:bg-bg-inset hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t("background.textColorReset")}
          </button>
        </div>
        {!compact && (
          <p className="mt-2 text-[11px] leading-relaxed text-fg-subtle">
            {t("background.textColorHint")}
          </p>
        )}
      </div>
      <OpacityControl
        id={compact ? "preview-background-opacity" : "background-image-opacity"}
        label={t("background.opacity")}
        hint={compact ? undefined : t("background.opacityHint")}
        value={draft.opacity}
        disabled={disabled}
        onChange={(opacity) => update({ opacity })}
      />

      <OpacityControl
        id={compact ? "preview-terminal-opacity" : "terminal-background-image-opacity"}
        label={t("background.terminalOpacity")}
        hint={compact ? undefined : t("background.terminalOpacityHint")}
        value={draft.terminalOpacity}
        disabled={disabled}
        onChange={(terminalOpacity) => update({ terminalOpacity })}
      />

    </div>
  );
}

function OpacityControl({
  id,
  label,
  hint,
  value,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  value: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <label htmlFor={id} className="text-xs font-medium text-fg">
          {label}
        </label>
        <output
          htmlFor={id}
          className="rounded border border-border bg-bg-inset px-1.5 py-0.5 font-mono text-[11px] text-fg-muted"
        >
          {value}%
        </output>
      </div>
      <input
        id={id}
        type="range"
        min={MIN_BACKGROUND_IMAGE_OPACITY}
        max={MAX_BACKGROUND_IMAGE_OPACITY}
        value={value}
        disabled={disabled}
        aria-valuetext={`${value}%`}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        className="h-1.5 w-full accent-accent disabled:cursor-not-allowed disabled:opacity-40"
      />
      {hint && (
        <p className="mt-2 text-[11px] leading-relaxed text-fg-subtle">{hint}</p>
      )}
    </div>
  );
}
