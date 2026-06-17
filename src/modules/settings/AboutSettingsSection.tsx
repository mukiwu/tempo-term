import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getVersion } from "@tauri-apps/api/app";
import { RefreshCw } from "lucide-react";
import { useUpdaterStore } from "@/stores/updaterStore";

/**
 * The "About" panel: app name, what it is, the running version, and a manual
 * "check for updates" control. The version is read from the Tauri runtime (the
 * single source of truth in tauri.conf.json) rather than hard-coded, so it
 * never drifts from the build.
 */
export function AboutSettingsSection() {
  const { t } = useTranslation("settings");
  const [version, setVersion] = useState<string | null>(null);

  const updaterStatus = useUpdaterStore((s) => s.status);
  const updaterVersion = useUpdaterStore((s) => s.version);
  const updaterError = useUpdaterStore((s) => s.errorMessage);
  const checkForUpdate = useUpdaterStore((s) => s.checkForUpdate);

  useEffect(() => {
    let active = true;
    getVersion()
      .then((v) => {
        if (active) {
          setVersion(v);
        }
      })
      .catch(() => {
        // Outside the Tauri runtime (e.g. a plain web preview) there is no
        // version to report; leave it blank instead of surfacing an error.
      });
    return () => {
      active = false;
    };
  }, []);

  const statusText = (() => {
    switch (updaterStatus) {
      case "checking":
        return t("update.checking");
      case "upToDate":
        return t("update.upToDate");
      case "available":
        return t("update.available", { version: updaterVersion });
      case "error":
        return updaterError || t("update.checkFailed");
      default:
        return "";
    }
  })();

  return (
    <section>
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-fg-subtle">
        {t("sections.about")}
      </h2>

      <div className="rounded-lg border border-border bg-bg-inset px-5 py-5">
        <div className="text-base font-semibold text-fg">{t("about.appName")}</div>
        <p className="mt-1 text-sm text-fg-muted">{t("about.tagline")}</p>

        <dl className="mt-5 space-y-2.5 text-sm">
          <div className="flex items-center justify-between">
            <dt className="text-fg-muted">{t("about.version")}</dt>
            <dd className="font-mono text-fg">{version ? `v${version}` : "—"}</dd>
          </div>
        </dl>

        <div className="mt-5 flex items-center justify-between border-t border-border pt-4">
          <span className="text-xs text-fg-muted">{statusText}</span>
          <button
            type="button"
            onClick={() => void checkForUpdate()}
            disabled={updaterStatus === "checking"}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-fg transition-colors hover:border-border-strong disabled:opacity-50"
          >
            <RefreshCw size={13} className={updaterStatus === "checking" ? "animate-spin" : ""} />
            {t("update.check")}
          </button>
        </div>
      </div>
    </section>
  );
}
