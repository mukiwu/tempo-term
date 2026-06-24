import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink, GitBranch, RefreshCw } from "lucide-react";
import { useUpdaterStore } from "@/stores/updaterStore";
import { appBuildInfo, osLabel, type AppBuildInfo } from "./buildInfo";

const REPO_URL = "https://github.com/mukiwu/tempo-term";
const ISSUES_URL = `${REPO_URL}/issues`;
const BUNDLE_ID = "com.tempoterm.desktop";
const REPO_LABEL = "mukiwu/tempo-term";

/**
 * The "About" panel: an identity card (icon, name, tagline, version), build
 * details (OS/arch/version, bundle id, source link), and actions (check for
 * updates, open the repo, report an issue). Version and OS/arch come from the
 * Tauri runtime so they never drift from the actual build. No license line yet.
 */
export function AboutSettingsSection() {
  const { t } = useTranslation("settings");
  const [version, setVersion] = useState<string | null>(null);
  const [build, setBuild] = useState<AppBuildInfo | null>(null);

  const updaterStatus = useUpdaterStore((s) => s.status);
  const updaterError = useUpdaterStore((s) => s.errorMessage);
  const checkManually = useUpdaterStore((s) => s.checkManually);

  useEffect(() => {
    let active = true;
    // Outside the Tauri runtime (e.g. a plain web preview) these have no answer;
    // leave them blank rather than surfacing an error.
    getVersion()
      .then((v) => {
        if (active) setVersion(v);
      })
      .catch(() => {});
    appBuildInfo()
      .then((b) => {
        if (active) setBuild(b);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const versionLabel = version ? `v${version}` : "—";
  const platformLabel = build ? osLabel(build.os) : "—";

  const statusText = (() => {
    switch (updaterStatus) {
      case "checking":
        return t("update.checking");
      case "upToDate":
        return t("update.upToDate");
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

      <div className="flex items-center gap-4 rounded-lg border border-border bg-bg-inset px-5 py-4">
        <img src="/icon.png" alt={t("about.appName")} className="h-14 w-14 shrink-0 rounded-xl" />
        <div className="min-w-0">
          <div className="text-base font-semibold text-fg">{t("about.appName")}</div>
          <p className="mt-0.5 truncate text-sm text-fg-muted">{t("about.tagline")}</p>
          <p className="mt-1 font-mono text-xs text-fg-subtle">{versionLabel}</p>
        </div>
      </div>

      <dl className="mt-5 grid grid-cols-[7rem_1fr] items-center gap-x-4 gap-y-3 text-sm">
        <dt className="text-fg-muted">{t("about.platform")}</dt>
        <dd className="font-mono text-fg">{platformLabel}</dd>

        <dt className="text-fg-muted">{t("about.bundleId")}</dt>
        <dd className="font-mono text-fg">{BUNDLE_ID}</dd>

        <dt className="text-fg-muted">{t("about.sourceCode")}</dt>
        <dd>
          <button
            type="button"
            onClick={() => void openUrl(REPO_URL)}
            className="inline-flex items-center gap-1.5 text-fg transition-colors hover:text-accent"
          >
            <GitBranch size={14} />
            {REPO_LABEL}
          </button>
        </dd>
      </dl>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void checkManually()}
          disabled={updaterStatus === "checking"}
          className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3.5 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          <RefreshCw size={14} className={updaterStatus === "checking" ? "animate-spin" : ""} />
          {t("update.check")}
        </button>
        <button
          type="button"
          onClick={() => void openUrl(REPO_URL)}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3.5 py-2 text-sm text-fg transition-colors hover:border-border-strong"
        >
          <ExternalLink size={14} />
          {t("about.viewOnGitHub")}
        </button>
        <button
          type="button"
          onClick={() => void openUrl(ISSUES_URL)}
          className="text-sm text-fg-muted transition-colors hover:text-fg"
        >
          {t("about.reportIssue")}
        </button>
      </div>

      {statusText && <p className="mt-3 text-xs text-fg-muted">{statusText}</p>}
    </section>
  );
}
