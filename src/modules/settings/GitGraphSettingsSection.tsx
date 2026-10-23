import { useTranslation } from "react-i18next";
import {
  GIT_AUTO_FETCH_OPTIONS,
  MAX_GIT_GRAPH_REF_LIMIT,
  MIN_GIT_GRAPH_REF_LIMIT,
  useSettingsStore,
} from "@/stores/settingsStore";

/** A titled row of mutually exclusive options. */
function ChoiceGroup<T extends string | number>({
  id,
  title,
  description,
  options,
  value,
  onChange,
}: {
  id: string;
  title: string;
  description: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="mt-6">
      <span id={id} className="mb-1 block text-sm font-medium text-fg">
        {title}
      </span>
      <p className="mb-2 text-xs text-fg-muted">{description}</p>
      <div role="radiogroup" aria-labelledby={id} className="flex flex-wrap gap-2">
        {options.map((option) => (
          <button
            key={String(option.value)}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            onClick={() => onChange(option.value)}
            className={`rounded-md border px-3 py-1.5 text-xs transition-colors ${
              value === option.value
                ? "border-accent bg-bg-elevated text-fg"
                : "border-border text-fg-muted hover:border-border-strong"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Git Graph display preferences. Every toggle here condenses the ref chips on a
 * commit row and ships on by default; turning them all off restores exactly the
 * row as it was before, so nobody's habits break on upgrade.
 */
export function GitGraphSettingsSection() {
  const { t } = useTranslation("settings");
  const refs = useSettingsStore((s) => s.gitGraphRefs);
  const setRefs = useSettingsStore((s) => s.setGitGraphRefs);
  const uncommittedRow = useSettingsStore((s) => s.gitGraphUncommittedRow);
  const setUncommittedRow = useSettingsStore((s) => s.setGitGraphUncommittedRow);
  const whenClean = useSettingsStore((s) => s.gitGraphUncommittedWhenClean);
  const setWhenClean = useSettingsStore((s) => s.setGitGraphUncommittedWhenClean);
  const columns = useSettingsStore((s) => s.gitGraphColumns);
  const setColumn = useSettingsStore((s) => s.setGitGraphColumn);
  const pullMode = useSettingsStore((s) => s.gitPullMode);
  const setPullMode = useSettingsStore((s) => s.setGitPullMode);
  const autoFetch = useSettingsStore((s) => s.gitAutoFetchMinutes);
  const setAutoFetch = useSettingsStore((s) => s.setGitAutoFetchMinutes);
  const notifySuccess = useSettingsStore((s) => s.gitNotifySuccess);
  const setNotifySuccess = useSettingsStore((s) => s.setGitNotifySuccess);

  return (
    <section>
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-fg-subtle">
        {t("sections.gitGraph")}
      </h2>

      <label className="mb-1 block text-sm font-medium text-fg">
        {t("gitGraph.uncommittedTitle")}
      </label>
      <p className="mb-2 text-xs text-fg-muted">{t("gitGraph.uncommittedDescription")}</p>
      <label className="mb-1 flex items-center gap-2 text-sm text-fg">
        <input
          type="checkbox"
          checked={uncommittedRow}
          onChange={(e) => setUncommittedRow(e.target.checked)}
          className="h-4 w-4 accent-accent"
        />
        {t("gitGraph.uncommittedRowLabel")}
      </label>
      <p className="mb-3 ml-6 text-xs text-fg-muted">{t("gitGraph.uncommittedRowHint")}</p>

      <label
        className={`mb-1 ml-6 flex items-center gap-2 text-sm ${
          uncommittedRow ? "text-fg" : "text-fg-subtle"
        }`}
      >
        <input
          type="checkbox"
          checked={whenClean}
          disabled={!uncommittedRow}
          onChange={(e) => setWhenClean(e.target.checked)}
          className="h-4 w-4 accent-accent disabled:opacity-50"
        />
        {t("gitGraph.uncommittedWhenCleanLabel")}
      </label>
      <p className="mb-6 ml-12 text-xs text-fg-muted">
        {t("gitGraph.uncommittedWhenCleanHint")}
      </p>

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

      <label className="mb-1 mt-6 block text-sm font-medium text-fg">
        {t("gitGraph.columnsTitle")}
      </label>
      <p className="mb-2 text-xs text-fg-muted">{t("gitGraph.columnsDescription")}</p>
      {(["hash", "author", "date"] as const).map((key) => (
        <label key={key} className="mb-1 flex items-center gap-2 text-sm text-fg">
          <input
            type="checkbox"
            checked={columns[key]}
            onChange={(e) => setColumn(key, e.target.checked)}
            className="h-4 w-4 accent-accent"
          />
          {t(`gitGraph.columns.${key}`)}
        </label>
      ))}

      <ChoiceGroup
        id="git-pull-mode"
        title={t("gitGraph.pullTitle")}
        description={t("gitGraph.pullDescription")}
        options={(["merge", "ff-only", "rebase"] as const).map((value) => ({
          value,
          label: t(`gitGraph.pullModes.${value}`),
        }))}
        value={pullMode}
        onChange={setPullMode}
      />

      <ChoiceGroup
        id="git-auto-fetch"
        title={t("gitGraph.autoFetchTitle")}
        description={t("gitGraph.autoFetchDescription")}
        options={GIT_AUTO_FETCH_OPTIONS.map((minutes) => ({
          value: minutes,
          label: minutes === 0 ? t("gitGraph.autoFetchOff") : t("gitGraph.autoFetchMinutes", { count: minutes }),
        }))}
        value={autoFetch}
        onChange={setAutoFetch}
      />

      <label className="mb-1 mt-6 flex items-center gap-2 text-sm font-medium text-fg">
        <input
          type="checkbox"
          checked={notifySuccess}
          onChange={(e) => setNotifySuccess(e.target.checked)}
          className="h-4 w-4 accent-accent"
        />
        {t("gitGraph.notifyLabel")}
      </label>
      <p className="ml-6 text-xs text-fg-muted">{t("gitGraph.notifyHint")}</p>
    </section>
  );
}
