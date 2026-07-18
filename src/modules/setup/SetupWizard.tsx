import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Check } from "lucide-react";
import { useOverlayGuard } from "@/lib/overlayGuard";
import { useSettingsStore } from "@/stores/settingsStore";
import { useUiStore } from "@/stores/uiStore";
import {
  detectTools,
  installTool,
  isToolReady,
  TOOL_REGISTRY,
  type DetectResult,
  type ToolId,
  type ToolStatus,
} from "@/modules/setup/lib/setupTools";

/** Per-tool UI phase driving the status pill and controls. */
type RowPhase = "checking" | "missing" | "outdated" | "ready" | "installing" | "failed";

function phaseFor(status: ToolStatus | undefined, installing: boolean, failed: boolean): RowPhase {
  if (!status) {
    return "checking";
  }
  if (installing) {
    return "installing";
  }
  if (isToolReady(status)) {
    return "ready";
  }
  if (failed) {
    return "failed";
  }
  if (status.installed && !status.meetsMin) {
    return "outdated";
  }
  return "missing";
}

/**
 * First-run setup wizard, presented one tool per step. Each step explains what
 * the tool does and lets the user install it or skip to the next one. A stepper
 * across the top shows overall progress. Dismissing the wizard (skip or finish)
 * marks onboarding complete so it never auto-opens again.
 */
export function SetupWizard() {
  useOverlayGuard(true);
  const { t } = useTranslation("onboarding");
  const setSetupWizardOpen = useUiStore((s) => s.setSetupWizardOpen);
  const setOnboardingCompleted = useSettingsStore((s) => s.setOnboardingCompleted);

  const [detection, setDetection] = useState<DetectResult | null>(null);
  const [step, setStep] = useState(0);
  const [installing, setInstalling] = useState<ToolId | null>(null);
  const [failed, setFailed] = useState<Set<ToolId>>(new Set());
  const [logLines, setLogLines] = useState<string[]>([]);
  const logBoxRef = useRef<HTMLDivElement | null>(null);
  // Guards against setState after unmount: install streams and detection resolve
  // asynchronously and can land after the user closes the wizard mid-run.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const total = TOOL_REGISTRY.length;
  const meta = TOOL_REGISTRY[step];
  const statusById = new Map<ToolId, ToolStatus>();
  for (const s of detection?.tools ?? []) {
    statusById.set(s.id, s);
  }
  const status = statusById.get(meta.id);
  const phase = phaseFor(status, installing === meta.id, failed.has(meta.id));
  const isLast = step === total - 1;

  const refresh = useCallback(async () => {
    try {
      const result = await detectTools();
      if (mountedRef.current) {
        setDetection(result);
      }
    } catch {
      // Detection failure leaves the step in its "checking" phase; the user can
      // still skip forward. Nothing actionable to surface here.
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Keep the newest line in view by scrolling the log container itself, rather
  // than scrollIntoView (which would also scroll the whole modal/page).
  useEffect(() => {
    const box = logBoxRef.current;
    if (box) {
      box.scrollTop = box.scrollHeight;
    }
  }, [logLines]);

  const close = useCallback(() => {
    setOnboardingCompleted(true);
    setSetupWizardOpen(false);
  }, [setOnboardingCompleted, setSetupWizardOpen]);

  // Esc closes the wizard (unless an install is mid-flight, to avoid orphaning
  // a running process silently). Mirrors ConfirmDialog's accessibility.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !installing) {
        close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, installing]);

  const goNext = useCallback(() => {
    if (isLast) {
      close();
      return;
    }
    setLogLines([]);
    setStep((s) => Math.min(total - 1, s + 1));
  }, [isLast, close, total]);

  const goBack = useCallback(() => {
    setLogLines([]);
    setStep((s) => Math.max(0, s - 1));
  }, []);

  const runInstall = useCallback(
    async (id: ToolId) => {
      if (installing) {
        return;
      }
      setInstalling(id);
      setLogLines([]);
      setFailed((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      let code = -1;
      try {
        code = await installTool(id, (line) => {
          if (mountedRef.current) setLogLines((prev) => [...prev, line]);
        });
      } catch (err) {
        if (mountedRef.current) setLogLines((prev) => [...prev, String(err)]);
      }
      if (!mountedRef.current) {
        return;
      }
      if (code !== 0) {
        setFailed((prev) => new Set(prev).add(id));
      }
      setInstalling(null);
      await refresh();
    },
    [installing, refresh],
  );

  const busy = installing !== null;

  return (
    <div onPointerDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
      <div className="fixed inset-0 z-[95] bg-black/60" />
      <div className="fixed left-1/2 top-1/2 z-[100] flex max-h-[88vh] w-[560px] max-w-[94vw] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-border bg-bg-elevated shadow-2xl">
        {/* Header + stepper */}
        <div className="border-b border-border px-6 pb-4 pt-5">
          <h2 className="text-base font-semibold text-fg">{t("title")}</h2>
          <p className="mt-0.5 text-xs text-fg-subtle">
            {t("stepLabel", { current: step + 1, total })}
          </p>
          <Stepper
            current={step}
            statuses={TOOL_REGISTRY.map((m) => ({
              phase: phaseFor(statusById.get(m.id), installing === m.id, failed.has(m.id)),
              label: t(`tools.${m.name}`),
            }))}
            onJump={(i) => {
              if (!busy) {
                setLogLines([]);
                setStep(i);
              }
            }}
          />
        </div>

        {/* Current tool */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold text-fg">{t(`tools.${meta.name}`)}</h3>
            {status?.version ? (
              <span className="text-xs text-fg-subtle">v{status.version}</span>
            ) : null}
            <StatusPill phase={phase} versionUnknown={status?.version == null} t={t} />
          </div>
          <p className="mt-2 text-sm leading-relaxed text-fg-muted">{t(`desc.${meta.name}`)}</p>

          {logLines.length > 0 ? (
            <div
              ref={logBoxRef}
              className="mt-4 max-h-44 overflow-y-auto rounded-lg border border-border bg-black/40 p-2.5 font-mono text-[11px] leading-relaxed text-fg-muted"
            >
              {logLines.map((line, i) => (
                <div key={i} className="whitespace-pre-wrap break-all">
                  {line}
                </div>
              ))}
            </div>
          ) : null}
        </div>

        {/* Footer / navigation */}
        <div className="flex items-center justify-between gap-2 border-t border-border px-6 py-3">
          <button
            type="button"
            onClick={close}
            disabled={busy}
            className="text-xs text-fg-subtle transition-colors hover:text-fg disabled:opacity-50"
          >
            {t("actions.skipAll")}
          </button>
          <div className="flex items-center gap-2">
            {step > 0 ? (
              <button
                type="button"
                onClick={goBack}
                disabled={busy}
                className="rounded-md px-3 py-1.5 text-xs text-fg-muted hover:bg-bg-inset disabled:opacity-50"
              >
                {t("actions.back")}
              </button>
            ) : null}
            {phase !== "ready" ? (
              <ActionButton
                phase={phase}
                installable={status?.installable ?? false}
                disabled={busy}
                onInstall={() => void runInstall(meta.id)}
                onOpenUrl={() => void openUrl(meta.url)}
                t={t}
              />
            ) : null}
            <button
              type="button"
              onClick={goNext}
              disabled={busy}
              className="rounded-md bg-accent px-4 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
            >
              {isLast
                ? phase === "ready"
                  ? t("actions.done")
                  : t("actions.finish")
                : phase === "ready"
                  ? t("actions.nextReady")
                  : t("actions.next")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The progress rail: one node per tool, with the current one highlighted and
 *  ready ones checked. Nodes are clickable to jump between steps. */
function Stepper({
  current,
  statuses,
  onJump,
}: {
  current: number;
  statuses: { phase: RowPhase; label: string }[];
  onJump: (index: number) => void;
}) {
  return (
    <div className="mt-4 flex items-center">
      {statuses.map((s, i) => {
        const isCurrent = i === current;
        const done = s.phase === "ready";
        return (
          <div key={i} className="flex flex-1 items-center last:flex-none">
            <button
              type="button"
              onClick={() => onJump(i)}
              title={s.label}
              className={[
                "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-medium transition-colors",
                isCurrent
                  ? "border-accent bg-accent text-white"
                  : done
                    ? "border-success bg-success/15 text-success"
                    : "border-border bg-bg-inset text-fg-subtle hover:border-border-strong",
              ].join(" ")}
            >
              {done && !isCurrent ? <Check size={13} /> : i + 1}
            </button>
            {i < statuses.length - 1 ? (
              <div className={`mx-1 h-px flex-1 ${i < current ? "bg-accent/60" : "bg-border"}`} />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function StatusPill({
  phase,
  versionUnknown = false,
  t,
}: {
  phase: RowPhase;
  /** True when the tool's version could not be read (backend reports
   *  installed with a null version). Only affects the "outdated" phase: the
   *  fail-closed verdict is right, but "Version too old" would be a lie —
   *  the version is unknown, not old. */
  versionUnknown?: boolean;
  t: (k: string) => string;
}) {
  const map: Record<RowPhase, { key: string; cls: string }> = {
    checking: { key: "status.checking", cls: "text-fg-subtle" },
    missing: { key: "status.missing", cls: "border border-border text-fg-muted" },
    outdated: { key: "status.outdated", cls: "border border-warning/40 text-warning" },
    ready: { key: "status.ready", cls: "border border-success/40 text-success" },
    installing: { key: "status.installing", cls: "border border-accent/40 text-accent" },
    failed: { key: "status.failed", cls: "border border-danger/40 text-danger" },
  };
  const { key, cls } = map[phase];
  const labelKey = phase === "outdated" && versionUnknown ? "status.unknownVersion" : key;
  return <span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] ${cls}`}>{t(labelKey)}</span>;
}

function ActionButton({
  phase,
  installable,
  disabled,
  onInstall,
  onOpenUrl,
  t,
}: {
  phase: RowPhase;
  installable: boolean;
  disabled: boolean;
  onInstall: () => void;
  onOpenUrl: () => void;
  t: (k: string) => string;
}) {
  if (installable) {
    return (
      <button
        type="button"
        onClick={onInstall}
        disabled={disabled}
        className="rounded-md border border-accent px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/10 disabled:opacity-50"
      >
        {phase === "outdated" ? t("actions.update") : t("actions.install")}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onOpenUrl}
      className="rounded-md border border-border px-3 py-1.5 text-xs text-fg-muted hover:bg-bg-inset"
    >
      {t("actions.download")}
    </button>
  );
}
