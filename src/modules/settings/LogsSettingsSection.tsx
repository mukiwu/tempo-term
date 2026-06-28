import { useTranslation } from "react-i18next";
import { useSettingsStore } from "@/stores/settingsStore";
import { Combobox } from "@/components/Combobox";
import { openSessionLogsDir } from "@/modules/logs/lib/sessionLog";

/** Retention dropdown option values; null means keep forever. */
const RETENTION_VALUES: (number | null)[] = [null, 7, 30, 90];

export function LogsSettingsSection() {
  const { t } = useTranslation("settings");
  const loggingEnabled = useSettingsStore((s) => s.loggingEnabled);
  const setLoggingEnabled = useSettingsStore((s) => s.setLoggingEnabled);
  const logRetentionDays = useSettingsStore((s) => s.logRetentionDays);
  const setLogRetentionDays = useSettingsStore((s) => s.setLogRetentionDays);

  const labelFor = (value: number | null): string => {
    if (value === null) return t("logsSettings.retentionForever");
    if (value === 7) return t("logsSettings.retention7");
    if (value === 90) return t("logsSettings.retention90");
    // 30 is the default; any unexpected value falls back to it rather than
    // silently masquerading as a different option.
    return t("logsSettings.retention30");
  };
  const options = RETENTION_VALUES.map(labelFor);

  return (
    <section>
      <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-fg-subtle">
        {t("sections.logs")}
      </h2>
      <p className="mb-6 text-xs text-fg-muted">{t("logsSettings.description")}</p>

      <div className="mb-6">
        <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-fg">
          <input
            type="checkbox"
            checked={loggingEnabled}
            onChange={(e) => setLoggingEnabled(e.target.checked)}
            className="accent-accent"
          />
          {t("logsSettings.enable")}
        </label>
        <p className="mt-1 text-xs text-fg-muted">{t("logsSettings.enableHint")}</p>
      </div>

      <div className="mb-6">
        <label className="mb-2 block text-sm font-medium text-fg">{t("logsSettings.retention")}</label>
        <Combobox
          value={labelFor(logRetentionDays)}
          options={options}
          ariaLabel={t("logsSettings.retention")}
          onChange={(label) => {
            const picked = RETENTION_VALUES.find((v) => labelFor(v) === label) ?? null;
            setLogRetentionDays(picked);
          }}
        />
      </div>

      <button
        type="button"
        onClick={() => void openSessionLogsDir().catch(() => {})}
        className="rounded-md border border-border px-3 py-1.5 text-xs text-fg-muted transition-colors hover:bg-bg-elevated hover:text-fg"
      >
        {t("logsSettings.openFolder")}
      </button>
    </section>
  );
}
