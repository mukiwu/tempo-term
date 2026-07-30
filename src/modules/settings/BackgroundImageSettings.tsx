import { useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { ImagePlus, RefreshCw, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  MAX_BACKGROUND_IMAGE_OPACITY,
  MIN_BACKGROUND_IMAGE_OPACITY,
  useSettingsStore,
  type BackgroundImageScope,
} from "@/stores/settingsStore";

const BACKGROUND_IMAGE_FILTER = [
  {
    name: "PNG, JPEG, WebP",
    extensions: ["png", "jpg", "jpeg", "webp"],
  },
];

export function BackgroundImageSettings() {
  const { t } = useTranslation("settings");
  const path = useSettingsStore((state) => state.backgroundImagePath);
  const opacity = useSettingsStore((state) => state.backgroundImageOpacity);
  const scope = useSettingsStore((state) => state.backgroundImageScope);
  const setBackgroundImage = useSettingsStore((state) => state.setBackgroundImage);
  const clearBackgroundImage = useSettingsStore((state) => state.clearBackgroundImage);
  const setOpacity = useSettingsStore((state) => state.setBackgroundImageOpacity);
  const setScope = useSettingsStore((state) => state.setBackgroundImageScope);
  const [busy, setBusy] = useState<"save" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);

  async function chooseImage() {
    setError(null);
    const selected = await open({
      directory: false,
      multiple: false,
      filters: BACKGROUND_IMAGE_FILTER,
    });
    if (typeof selected !== "string") {
      return;
    }

    setBusy("save");
    try {
      const savedPath = await invoke<string>("appearance_save_background_image", {
        sourcePath: selected,
      });
      setBackgroundImage(savedPath);
      setPreviewFailed(false);
    } catch {
      setError(t("background.saveError"));
    } finally {
      setBusy(null);
    }
  }

  async function removeImage() {
    setError(null);
    setBusy("remove");
    try {
      await invoke("appearance_remove_background_image");
      clearBackgroundImage();
      setPreviewFailed(false);
    } catch {
      setError(t("background.removeError"));
    } finally {
      setBusy(null);
    }
  }

  const scopeOptions: BackgroundImageScope[] = ["workspace", "window"];

  return (
    <div>
      <div className="mb-4">
        <h3 className="text-sm font-medium text-fg">{t("background.label")}</h3>
        <p className="mt-1 max-w-2xl text-xs leading-relaxed text-fg-muted">
          {t("background.description")}
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(240px,0.65fr)]">
        <div
          data-testid="background-image-preview"
          className="relative aspect-video min-h-48 overflow-hidden rounded-xl border border-border-strong bg-bg-inset"
        >
          {path && !previewFailed ? (
            <>
              <img
                src={convertFileSrc(path)}
                alt={t("background.previewAlt")}
                className="absolute inset-0 h-full w-full object-cover object-center"
                style={{ opacity: opacity / 100 }}
                onError={() => {
                  setPreviewFailed(true);
                  setError(t("background.loadError"));
                }}
              />
              <div className="pointer-events-none absolute inset-0 ring-1 ring-inset ring-white/5" />
              <div className="absolute bottom-3 left-3 rounded-md border border-white/10 bg-bg-elevated/90 px-2 py-1 text-[11px] text-fg shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
                {t(`background.scope.${scope}`)}
              </div>
            </>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
              <span className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-bg-elevated text-fg-muted">
                <ImagePlus size={20} strokeWidth={1.5} />
              </span>
              <div>
                <p className="text-sm font-medium text-fg">
                  {previewFailed ? t("background.previewUnavailable") : t("background.emptyTitle")}
                </p>
                <p className="mt-1 text-xs text-fg-muted">{t("background.formats")}</p>
              </div>
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-col justify-between gap-5">
          <div className="space-y-5">
            <div>
              <label className="mb-2 block text-xs font-medium text-fg">
                {t("background.scopeLabel")}
              </label>
              <div className="grid grid-cols-2 rounded-lg border border-border bg-bg-inset p-1">
                {scopeOptions.map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={scope === option}
                    onClick={() => setScope(option)}
                    className={`rounded-md px-2 py-1.5 text-xs transition-[background-color,color,transform] active:scale-[0.98] ${
                      scope === option
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
              <div className="mb-2 flex items-center justify-between gap-3">
                <label htmlFor="background-image-opacity" className="text-xs font-medium text-fg">
                  {t("background.opacity")}
                </label>
                <output
                  htmlFor="background-image-opacity"
                  className="rounded border border-border bg-bg-inset px-1.5 py-0.5 font-mono text-[11px] text-fg-muted"
                >
                  {opacity}%
                </output>
              </div>
              <input
                id="background-image-opacity"
                type="range"
                min={MIN_BACKGROUND_IMAGE_OPACITY}
                max={MAX_BACKGROUND_IMAGE_OPACITY}
                value={opacity}
                disabled={!path}
                aria-valuetext={`${opacity}%`}
                onChange={(event) => setOpacity(Number(event.currentTarget.value))}
                className="h-1.5 w-full accent-accent disabled:cursor-not-allowed disabled:opacity-40"
              />
              <p className="mt-2 text-[11px] leading-relaxed text-fg-subtle">
                {t("background.opacityHint")}
              </p>
            </div>
          </div>

          <div>
            {error && (
              <p role="alert" className="mb-2 text-xs leading-relaxed text-danger">
                {error}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void chooseImage()}
                className="inline-flex items-center gap-1.5 rounded-md border border-accent bg-bg-elevated px-3 py-1.5 text-xs font-medium text-fg transition-[background-color,transform] hover:bg-bg-inset active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {path ? (
                  <RefreshCw size={14} strokeWidth={1.5} />
                ) : (
                  <ImagePlus size={14} strokeWidth={1.5} />
                )}
                {busy === "save"
                  ? t("background.saving")
                  : path
                    ? t("background.replace")
                    : t("background.choose")}
              </button>
              {path && (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void removeImage()}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-fg-muted transition-[border-color,color,transform] hover:border-danger/60 hover:text-danger active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Trash2 size={14} strokeWidth={1.5} />
                  {busy === "remove" ? t("background.removing") : t("background.remove")}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
