import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, KeyRound } from "lucide-react";
import {
  useSettingsStore,
  type WorkspaceCardBlocks,
  type WorkspacePrSource,
} from "@/stores/settingsStore";
import { ghAvailable } from "@/modules/workspace/lib/prBridge";
import { secretsDeleteKey, secretsHasKey, secretsSetKey } from "@/modules/ai/lib/aiBridge";
import {
  installStatusHook,
  uninstallStatusHook,
  installCodexStatusHook,
  uninstallCodexStatusHook,
} from "@/modules/claude-progress/lib/statusHookBridge";
import { ensureNotificationPermission } from "@/modules/claude-progress/lib/notify";

/** Keychain account the GitHub API token is stored under (matches the backend). */
const GITHUB_PROVIDER = "github";

const BLOCKS: { key: keyof WorkspaceCardBlocks; labelKey: string }[] = [
  { key: "status", labelKey: "workspace.blockStatus" },
  { key: "branch", labelKey: "workspace.blockBranch" },
  { key: "cwd", labelKey: "workspace.blockCwd" },
  { key: "pr", labelKey: "workspace.blockPr" },
];

const SOURCES: { value: WorkspacePrSource; labelKey: string }[] = [
  { value: "auto", labelKey: "workspace.prAuto" },
  { value: "gh", labelKey: "workspace.prGh" },
  { value: "token", labelKey: "workspace.prToken" },
  { value: "off", labelKey: "workspace.prOff" },
];

function TokenRow() {
  const { t } = useTranslation("settings");
  const [hasKey, setHasKey] = useState(false);
  const [value, setValue] = useState("");

  const refresh = () => {
    secretsHasKey(GITHUB_PROVIDER).then(setHasKey).catch(() => setHasKey(false));
  };
  useEffect(refresh, []);

  return (
    <div className="mt-3 flex items-center gap-3">
      <KeyRound size={15} className="shrink-0 text-fg-subtle" />
      <span className="w-28 shrink-0 text-sm text-fg">{t("workspace.tokenLabel")}</span>
      <form
        className="flex flex-1 items-center gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!value.trim()) {
            return;
          }
          await secretsSetKey(GITHUB_PROVIDER, value.trim());
          setValue("");
          refresh();
        }}
      >
        <input
          type="password"
          value={value}
          placeholder={t("workspace.tokenPlaceholder")}
          onChange={(e) => setValue(e.target.value)}
          className="flex-1 rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg outline-none focus:border-accent"
        />
        <button
          type="submit"
          className="rounded-md bg-accent px-3 py-1 text-xs font-medium text-white"
        >
          {t("workspace.tokenSave")}
        </button>
      </form>
      {hasKey && (
        <button
          type="button"
          onClick={async () => {
            await secretsDeleteKey(GITHUB_PROVIDER);
            refresh();
          }}
          className="rounded-md border border-border px-3 py-1 text-xs text-danger hover:border-danger/60"
        >
          {t("workspace.tokenRemove")}
        </button>
      )}
      <span className={`flex items-center gap-1 text-xs ${hasKey ? "text-success" : "text-fg-subtle"}`}>
        {hasKey && <Check size={13} />}
        {hasKey ? t("workspace.tokenSet") : t("workspace.tokenNotSet")}
      </span>
    </div>
  );
}

export function WorkspaceSettingsSection() {
  const { t } = useTranslation("settings");
  const card = useSettingsStore((s) => s.workspaceCard);
  const setBlock = useSettingsStore((s) => s.setWorkspaceCardBlock);
  const prSource = useSettingsStore((s) => s.prSource);
  const setPrSource = useSettingsStore((s) => s.setPrSource);
  const statusTracking = useSettingsStore((s) => s.claudeStatusTracking);
  const setStatusTracking = useSettingsStore((s) => s.setClaudeStatusTracking);
  const notifications = useSettingsStore((s) => s.claudeNotifications);
  const setNotifications = useSettingsStore((s) => s.setClaudeNotifications);
  const claudeFlags = useSettingsStore((s) => s.claudeFlags);
  const setClaudeFlags = useSettingsStore((s) => s.setClaudeFlags);
  const codexFlags = useSettingsStore((s) => s.codexFlags);
  const setCodexFlags = useSettingsStore((s) => s.setCodexFlags);
  const [ghReady, setGhReady] = useState<boolean | null>(null);

  async function toggleStatusTracking(checked: boolean) {
    setStatusTracking(checked);
    try {
      if (checked) {
        await installStatusHook();
        await installCodexStatusHook();
      } else {
        await uninstallStatusHook();
        await uninstallCodexStatusHook();
      }
    } catch {
      // Keep the toggle in sync with the real system state: if install or
      // uninstall failed, the hook is in the opposite state from what we set.
      setStatusTracking(!checked);
    }
  }

  async function toggleNotifications(checked: boolean) {
    setNotifications(checked);
    if (checked) {
      // Prompt for OS permission the moment the user opts in, so the first real
      // notification fires without a permission dialog racing it.
      await ensureNotificationPermission();
    }
  }

  useEffect(() => {
    ghAvailable()
      .then(setGhReady)
      .catch(() => setGhReady(false));
  }, []);

  return (
    <section>
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-fg-subtle">
        {t("sections.workspace")}
      </h2>

      <label className="mb-1 block text-sm font-medium text-fg">{t("workspace.blocksTitle")}</label>
      <p className="mb-2 text-xs text-fg-muted">{t("workspace.blocksDescription")}</p>
      <div className="mb-6 space-y-1.5">
        {BLOCKS.map(({ key, labelKey }) => (
          <label key={key} className="flex items-center gap-2 text-sm text-fg">
            <input
              type="checkbox"
              checked={card[key]}
              onChange={(e) => setBlock(key, e.target.checked)}
              className="h-4 w-4 accent-accent"
            />
            {t(labelKey)}
          </label>
        ))}
      </div>

      <label className="mb-1 block text-sm font-medium text-fg">
        {t("workspace.statusTrackingTitle")}
      </label>
      <p className="mb-2 text-xs text-fg-muted">{t("workspace.statusTrackingDescription")}</p>
      <label className="mb-3 flex items-center gap-2 text-sm text-fg">
        <input
          type="checkbox"
          checked={statusTracking}
          onChange={(e) => void toggleStatusTracking(e.target.checked)}
          className="h-4 w-4 accent-accent"
        />
        {t("workspace.statusTrackingLabel")}
      </label>
      <label
        className={`mb-6 flex items-center gap-2 text-sm ${
          statusTracking ? "text-fg" : "text-fg-subtle"
        }`}
        title={statusTracking ? undefined : t("workspace.notificationsRequiresTracking")}
      >
        <input
          type="checkbox"
          checked={notifications}
          disabled={!statusTracking}
          onChange={(e) => void toggleNotifications(e.target.checked)}
          className="h-4 w-4 accent-accent disabled:opacity-50"
        />
        {t("workspace.notificationsLabel")}
      </label>

      <label className="mb-1 block text-sm font-medium text-fg">
        {t("workspace.launcherFlagsTitle")}
      </label>
      <p className="mb-2 text-xs text-fg-muted">{t("workspace.launcherFlagsDescription")}</p>
      <div className="mb-6 space-y-2">
        <label className="flex items-center gap-3 text-sm text-fg">
          <span className="shrink-0 whitespace-nowrap">{t("workspace.claudeFlagsLabel")}</span>
          <input
            type="text"
            value={claudeFlags}
            placeholder={t("workspace.claudeFlagsPlaceholder")}
            onChange={(e) => setClaudeFlags(e.target.value)}
            className="flex-1 rounded-md border border-border bg-bg px-2 py-1 font-mono text-sm text-fg outline-none focus:border-accent"
          />
        </label>
        <label className="flex items-center gap-3 text-sm text-fg">
          <span className="shrink-0 whitespace-nowrap">{t("workspace.codexFlagsLabel")}</span>
          <input
            type="text"
            value={codexFlags}
            placeholder={t("workspace.codexFlagsPlaceholder")}
            onChange={(e) => setCodexFlags(e.target.value)}
            className="flex-1 rounded-md border border-border bg-bg px-2 py-1 font-mono text-sm text-fg outline-none focus:border-accent"
          />
        </label>
      </div>

      <label className="mb-1 block text-sm font-medium text-fg">{t("workspace.prTitle")}</label>
      <p className="mb-2 text-xs text-fg-muted">{t("workspace.prDescription")}</p>
      <div className="flex flex-wrap gap-2">
        {SOURCES.map(({ value, labelKey }) => (
          <button
            key={value}
            type="button"
            aria-pressed={prSource === value}
            onClick={() => setPrSource(value)}
            className={`rounded-md border px-3 py-1.5 text-xs transition-colors ${
              prSource === value
                ? "border-accent bg-bg-elevated text-fg"
                : "border-border text-fg-muted hover:border-border-strong"
            }`}
          >
            {t(labelKey)}
          </button>
        ))}
      </div>
      {ghReady !== null && (
        <p className={`mt-2 text-xs ${ghReady ? "text-success" : "text-fg-subtle"}`}>
          {ghReady ? t("workspace.ghDetected") : t("workspace.ghMissing")}
        </p>
      )}

      {prSource === "token" && <TokenRow />}
    </section>
  );
}
