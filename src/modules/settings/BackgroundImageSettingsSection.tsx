import { useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Check,
  Eye,
  ImagePlus,
  RefreshCw,
  RotateCcw,
  Trash2,
  Upload,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  listenToNativeDragDrop,
  nativePointInElement,
} from "@/lib/nativeDragCoordinates";
import { useSettingsStore } from "@/stores/settingsStore";
import {
  backgroundImageDraftIsDirty,
  commitBackgroundImageDraft,
  useBackgroundImageDraftStore,
} from "@/stores/backgroundImageDraftStore";
import { BackgroundImageDraftControls } from "./BackgroundImageDraftControls";

const BACKGROUND_IMAGE_FILTER = [
  {
    name: "PNG, JPEG, WebP",
    extensions: ["png", "jpg", "jpeg", "webp"],
  },
];

export function BackgroundImageSettingsSection() {
  const { t } = useTranslation("settings");
  const path = useSettingsStore((state) => state.backgroundImagePath);
  const opacity = useSettingsStore((state) => state.backgroundImageOpacity);
  const terminalOpacity = useSettingsStore(
    (state) => state.terminalBackgroundImageOpacity,
  );
  const scope = useSettingsStore((state) => state.backgroundImageScope);
  const textColor = useSettingsStore((state) => state.backgroundImageTextColor);
  const draft = useBackgroundImageDraftStore((state) => state.draft);
  const baseline = useBackgroundImageDraftStore((state) => state.baseline);
  const busy = useBackgroundImageDraftStore((state) => state.busy);
  const errorKey = useBackgroundImageDraftStore((state) => state.errorKey);
  const begin = useBackgroundImageDraftStore((state) => state.begin);
  const stageImage = useBackgroundImageDraftStore((state) => state.stageImage);
  const stageRemoval = useBackgroundImageDraftStore((state) => state.stageRemoval);
  const resetChanges = useBackgroundImageDraftStore((state) => state.resetChanges);
  const enterPreview = useBackgroundImageDraftStore((state) => state.enterPreview);
  const markImageFailed = useBackgroundImageDraftStore(
    (state) => state.markImageFailed,
  );
  const clearError = useBackgroundImageDraftStore((state) => state.clearError);
  const [dragActive, setDragActive] = useState(false);
  const [dropError, setDropError] = useState<string | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    begin({ path, opacity, terminalOpacity, scope, textColor });
  }, [begin, opacity, path, scope, terminalOpacity, textColor]);

  async function chooseImage() {
    clearError();
    setDropError(null);
    const selected = await open({
      directory: false,
      multiple: false,
      filters: BACKGROUND_IMAGE_FILTER,
    });
    if (typeof selected === "string") stageImage(selected);
  }

  useEffect(() => {
    const preview = previewRef.current;
    if (!preview) return;

    const stopListening = listenToNativeDragDrop((event) => {
      const payload = event.payload;
      if (payload.type === "leave") {
        setDragActive(false);
        return false;
      }

      const inside = nativePointInElement(
        preview,
        payload.position.x,
        payload.position.y,
      );
      if (payload.type === "enter" || payload.type === "over") {
        setDragActive(inside);
        return inside;
      }

      setDragActive(false);
      if (!inside || busy) return inside;
      if (payload.paths.length !== 1) {
        setDropError(t("background.dropSingleError"));
        return true;
      }
      setDropError(null);
      stageImage(payload.paths[0]);
      return true;
    }, 100);

    return stopListening;
  }, [busy, stageImage, t]);

  if (!draft) return null;

  const dirty = backgroundImageDraftIsDirty(baseline, draft);
  const canPreview = Boolean(
    !draft.imageFailed && (draft.path || (baseline?.path && !draft.path)),
  );
  const previewIsPending = draft.sourcePath !== null;

  return (
    <div>
      <div className="mb-4">
        <h3 className="text-sm font-medium text-fg">{t("background.label")}</h3>
        <p className="mt-1 max-w-2xl text-xs leading-relaxed text-fg-muted">
          {t("background.description")}
        </p>
      </div>

      <div className="flex flex-col gap-5">
        <div>
          {/* The card is the picker: click (or Enter/Space) opens the file
              dialog, drag-and-drop keeps working, and when an image is set the
              corner overlay carries replace/remove. Source-selection actions
              live here; the footer row keeps only the draft-lifecycle ones. */}
          <div
            ref={previewRef}
            data-testid="background-image-preview"
            role="button"
            tabIndex={busy ? -1 : 0}
            aria-label={t("background.dropZoneLabel")}
            onClick={() => {
              if (!busy) void chooseImage();
            }}
            onKeyDown={(event) => {
              if (busy) return;
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                void chooseImage();
              }
            }}
            className={`relative aspect-[21/9] max-h-80 min-h-48 w-full cursor-pointer overflow-hidden rounded-xl border bg-bg-inset transition-[border-color,box-shadow] hover:border-accent/50 ${
              dragActive
                ? "border-accent shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-accent)_20%,transparent)]"
                : "border-border-strong"
            }`}
          >
            {draft.path && !draft.imageFailed ? (
              <>
                <img
                  src={convertFileSrc(draft.path)}
                  alt={t("background.previewAlt")}
                  className="absolute inset-0 h-full w-full object-cover object-center"
                  onError={markImageFailed}
                />
                <div className="pointer-events-none absolute inset-0 ring-1 ring-inset ring-white/5" />
                <div className="absolute bottom-3 left-3 rounded-md border border-white/10 bg-bg-elevated/90 px-2 py-1 text-[11px] text-fg shadow-sm">
                  {t("background.sourceImage")}
                </div>
                {dirty && (
                  <div className="absolute left-3 top-3 rounded-md border border-accent/50 bg-bg-elevated/95 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-accent shadow-sm">
                    {t("background.pendingPreview")}
                  </div>
                )}
              </>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
                <span className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-bg-elevated text-fg-muted">
                  <ImagePlus size={20} strokeWidth={1.5} />
                </span>
                <div>
                  <p className="text-sm font-medium text-fg">
                    {draft.imageFailed
                      ? t("background.previewUnavailable")
                      : baseline?.path && !draft.path
                        ? t("background.removalPreview")
                        : t("background.emptyTitle")}
                  </p>
                  <p className="mt-1 text-xs text-fg-muted">
                    {baseline?.path && !draft.path
                      ? t("background.removalPreviewHint")
                      : t("background.formats")}
                  </p>
                </div>
              </div>
            )}

            <div
              aria-hidden={!dragActive}
              className={`pointer-events-none absolute inset-2 flex items-center justify-center rounded-lg border-2 border-dashed transition-[border-color,background-color,opacity] ${
                dragActive
                  ? "border-accent bg-bg-elevated/90 opacity-100"
                  : "border-transparent opacity-0"
              }`}
            >
              <div className="flex items-center gap-2 rounded-lg border border-border-strong bg-bg-elevated px-3 py-2 text-sm font-medium text-fg shadow-lg">
                <Upload size={17} strokeWidth={1.75} className="text-accent" />
                {draft.path ? t("background.dropReplace") : t("background.dropAdd")}
              </div>
            </div>
            {!dragActive && !busy && (
              <div className="pointer-events-none absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-bg-elevated/90 px-2 py-1 text-[11px] text-fg-muted shadow-sm">
                <Upload size={12} strokeWidth={1.5} />
                {t("background.dropHint")}
              </div>
            )}
            {draft.path && !draft.imageFailed && !dragActive && !busy && (
              <div className="absolute bottom-3 right-3 flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    void chooseImage();
                  }}
                  className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-bg-elevated/90 px-2 py-1 text-[11px] text-fg shadow-sm transition-colors hover:border-accent/60"
                >
                  <RefreshCw size={12} />
                  {t("background.replace")}
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    stageRemoval();
                  }}
                  className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-bg-elevated/90 px-2 py-1 text-[11px] text-fg-muted shadow-sm transition-colors hover:border-danger/60 hover:text-danger"
                >
                  <Trash2 size={12} />
                  {t("background.remove")}
                </button>
              </div>
            )}
            {busy && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-bg-elevated/85">
                <div className="inline-flex items-center gap-2 rounded-lg border border-border-strong bg-bg-elevated px-3 py-2 text-sm text-fg shadow-lg">
                  <RefreshCw size={16} className="animate-spin text-accent" />
                  {t("background.saving")}
                </div>
              </div>
            )}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-fg-subtle">
            {t("background.sourceImageHint")}
          </p>
        </div>

        <div className="border-t border-border pt-5">
          <BackgroundImageDraftControls columns />
        </div>

        <div className="border-t border-border pt-5">
          <div>
            {(dropError || errorKey) && (
              <p role="alert" className="mb-2 text-xs leading-relaxed text-danger">
                {dropError ?? t(errorKey!)}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!canPreview || busy}
                onClick={enterPreview}
                className="inline-flex items-center gap-1.5 rounded-md border border-accent bg-bg-elevated px-3 py-1.5 text-xs font-semibold text-accent transition-[background-color,transform] hover:bg-bg-inset active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Eye size={14} />
                {t("background.previewActual")}
              </button>
              <button
                type="button"
                disabled={!dirty || busy || draft.imageFailed}
                onClick={() => void commitBackgroundImageDraft()}
                className="inline-flex items-center gap-1.5 rounded-md border border-accent bg-accent px-3 py-1.5 text-xs font-semibold text-white transition-[opacity,transform] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Check size={14} />
                {busy ? t("background.saving") : t("background.applyChanges")}
              </button>
              <button
                type="button"
                disabled={!dirty || busy}
                onClick={resetChanges}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-fg-muted transition-colors hover:text-fg disabled:opacity-40"
              >
                <RotateCcw size={14} />
                {t("background.cancelChanges")}
              </button>
            </div>
            {previewIsPending && (
              <p className="mt-2 text-[11px] text-accent">
                {t("background.importOnApply")}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
