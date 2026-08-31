import { useTranslation } from "react-i18next";
import {
  MAX_GIT_GRAPH_REF_LIMIT,
  MIN_GIT_GRAPH_REF_LIMIT,
  useSettingsStore,
} from "@/stores/settingsStore";

/**
 * Git Graph display preferences. Every toggle here condenses the ref chips on a
 * commit row and ships on by default; turning them all off restores exactly the
 * row as it was before, so nobody's habits break on upgrade.
 */
export function GitGraphSettingsSection() {
  const { t } = useTranslation("settings");
  const refs = useSettingsStore((s) => s.gitGraphRefs);
  const setRefs = useSettingsStore((s) => s.setGitGraphRefs);

  return (
    <section>
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-fg-subtle">
        {t("sections.gitGraph")}
      </h2>

      <label className="mb-1 block text-sm font-medium text-fg">{t("gitGraph.refsTitle")}</label>
      <p className="mb-2 text-xs text-fg-muted">{t("gitGraph.refsDescription")}</p>

      <label className="mb-1 flex items-center gap-2 text-sm text-fg">
        <input
          type="checkbox"
          checked={refs.mergeLocalRemote}
          onChange={(e) => setRefs({ mergeLocalRemote: e.target.checked })}
          className="h-4 w-4 accent-accent"
        />
        {t("gitGraph.mergeLocalRemoteLabel")}
      </label>
      <p className="mb-3 ml-6 text-xs text-fg-muted">{t("gitGraph.mergeLocalRemoteHint")}</p>

      <label className="mb-1 flex items-center gap-2 text-sm text-fg">
        <input
          type="checkbox"
          checked={refs.hideOriginHead}
          onChange={(e) => setRefs({ hideOriginHead: e.target.checked })}
          className="h-4 w-4 accent-accent"
        />
        {t("gitGraph.hideOriginHeadLabel")}
      </label>
      <p className="mb-3 ml-6 text-xs text-fg-muted">{t("gitGraph.hideOriginHeadHint")}</p>

      <label className="mb-1 flex items-center gap-2 text-sm text-fg">
        <input
          type="checkbox"
          checked={refs.collapseExtraRefs}
          onChange={(e) => setRefs({ collapseExtraRefs: e.target.checked })}
          className="h-4 w-4 accent-accent"
        />
        {t("gitGraph.collapseLabel")}
      </label>
      <label
        className={`mb-1 ml-6 flex items-center gap-2 text-sm ${
          refs.collapseExtraRefs ? "text-fg" : "text-fg-subtle"
        }`}
      >
        {t("gitGraph.refLimitLabel")}
        <input
          type="number"
          min={MIN_GIT_GRAPH_REF_LIMIT}
          max={MAX_GIT_GRAPH_REF_LIMIT}
          value={refs.refLimit}
          disabled={!refs.collapseExtraRefs}
          onChange={(e) => setRefs({ refLimit: Number(e.target.value) })}
          className="w-16 rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg outline-none focus:border-accent disabled:opacity-50"
        />
      </label>
      <p className="ml-6 text-xs text-fg-muted">{t("gitGraph.collapseHint")}</p>
    </section>
  );
}
