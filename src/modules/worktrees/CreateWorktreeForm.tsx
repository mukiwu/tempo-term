import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Combobox } from "@/components/Combobox";
import type { AgentKind } from "@/modules/claude-progress/lib/codexNormalize";
import { writeToTerminal } from "@/modules/terminal/lib/terminalBus";
import { useNotifyStore } from "@/stores/notifyStore";
import { useTabsStore } from "@/stores/tabsStore";
import { DEFAULT_COPY_GLOBS, useWorktreeSettingsStore } from "@/stores/worktreeSettingsStore";
import { gitWorktreeCopyLocalFiles } from "./lib/worktreesBridge";
import { useWorktreesStore } from "./lib/worktreesStore";
import { afterCreateCommand } from "./lib/afterCreate";
import { branchNameError, worktreePathFor } from "./lib/worktreePath";

const AGENT_OPTIONS: (AgentKind | null)[] = [null, "claude", "codex"];

/**
 * Name a branch, get a worktree.
 *
 * The resolved path is shown while the name is typed, before anything is
 * created: a worktree is a real directory that will sit on disk carrying its own
 * `node_modules`, and being surprised by where it went is the kind of thing that
 * gets found out much later, by a full disk.
 *
 * The three options under it are what make a fresh worktree usable rather than
 * merely present — `git worktree add` gives tracked source only, so without them
 * the first command dies on a missing `.env` or an empty `node_modules`.
 */
export function CreateWorktreeForm({
  repoPath,
  onDone,
}: {
  repoPath: string;
  /** Called once the worktree exists and its terminal is open. */
  onDone: () => void;
}) {
  const { t } = useTranslation("worktrees");
  const [branch, setBranch] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const create = useWorktreesStore((s) => s.create);
  const settings = useWorktreeSettingsStore((s) => s.byRepo[repoPath]);
  const setRepoSettings = useWorktreeSettingsStore((s) => s.setRepoSettings);

  const container = settings?.containerPath;
  const [setupCommand, setSetupCommand] = useState(settings?.setupCommand ?? "");
  const [copyGlobs, setCopyGlobs] = useState((settings?.copyGlobs ?? DEFAULT_COPY_GLOBS).join(", "));
  const [agent, setAgent] = useState<AgentKind | null>(settings?.lastAgent ?? null);

  const nameError = branchNameError(branch);
  // An empty field is the starting state, not a mistake — say nothing until they
  // have typed something that cannot work.
  const shownError = branch.trim() && nameError ? nameError : null;
  const path = useMemo(
    () => (nameError ? null : worktreePathFor(repoPath, branch.trim(), container)),
    [repoPath, branch, container, nameError],
  );

  const globList = () =>
    copyGlobs
      .split(",")
      .map((glob) => glob.trim())
      .filter(Boolean);

  const submit = async () => {
    if (!path || busy) {
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      const result = await create(repoPath, branch.trim(), path);

      // Remember what worked, so the next worktree in this repo does not have to
      // be told again.
      setRepoSettings(repoPath, {
        setupCommand: setupCommand.trim() || undefined,
        copyGlobs: globList(),
        lastAgent: agent ?? undefined,
      });

      // Before the terminal, not after: the setup command may well read `.env`,
      // and a shell that starts first would race it.
      const globs = globList();
      let copyFailure: string | null = null;
      if (globs.length > 0) {
        try {
          await gitWorktreeCopyLocalFiles(repoPath, result.path, globs);
        } catch (error) {
          // The worktree exists and is usable; this is a degraded create, not a
          // failed one. Saying "failed" would send the user to retry a name that
          // now exists.
          copyFailure = typeof error === "string" ? error : String(error);
        }
      }

      // Where git says it landed, not where we predicted — the two can differ
      // once the path has been canonicalized.
      const tabId = useTabsStore.getState().newTerminalTab(result.path);
      const created = useTabsStore.getState().tabs.find((tab) => tab.id === tabId);
      const command = copyFailure ? null : afterCreateCommand({ setupCommand, agent });
      if (created && command) {
        // CR, not LF: it is the byte Enter sends, and Windows' PSReadLine reads
        // LF as a continuation that never submits. `writeToTerminal` queues
        // until the fresh pty registers, so there is no startup race.
        writeToTerminal(created.activeLeafId, `${command}\r`);
      }

      if (copyFailure) {
        // Said out loud, then out of the way. The worktree is on disk and its
        // terminal is open, so holding the form up with an error leaves the
        // only clickable thing being Create — which now dies on "branch already
        // exists". Reporting a completed thing as failed is the same trap as a
        // failed rescan, wearing a different hat.
        useNotifyStore.getState().notify(t("create.copyFailed", { error: copyFailure }));
      }
      onDone();
    } catch (error) {
      // git's own words. It knows things this side does not: an existing branch,
      // an occupied directory, a repo mid-rebase.
      setFailure(typeof error === "string" ? error : ((error as Error)?.message ?? String(error)));
      setBusy(false);
    }
  };

  return (
    <form
      className="flex flex-col gap-4 px-4 py-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-fg-muted">{t("create.branch")}</span>
        <input
          autoFocus
          type="text"
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
          placeholder={t("create.branchPlaceholder")}
          spellCheck={false}
          className="rounded-md border border-border bg-bg-inset px-2.5 py-1.5 font-mono text-sm text-fg outline-none focus:border-accent"
        />
        <span className="text-[11px] text-fg-subtle">{t("create.branchHint")}</span>
      </label>

      {shownError ? (
        <p role="alert" className="text-xs text-danger">
          {t(`create.error.${shownError}`)}
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-fg-muted">{t("create.path")}</span>
          <span className="truncate font-mono text-[11px] text-fg-subtle">
            {path ?? worktreePathFor(repoPath, "…", container)}
          </span>
        </div>
      )}

      <div className="flex flex-col gap-3 border-t border-border pt-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-fg-muted">{t("create.setup")}</span>
          <input
            type="text"
            value={setupCommand}
            onChange={(e) => setSetupCommand(e.target.value)}
            placeholder={t("create.setupPlaceholder")}
            spellCheck={false}
            className="rounded-md border border-border bg-bg-inset px-2.5 py-1.5 font-mono text-xs text-fg outline-none focus:border-accent"
          />
          <span className="text-[11px] text-fg-subtle">{t("create.setupHint")}</span>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-fg-muted">{t("create.copy")}</span>
          <input
            type="text"
            value={copyGlobs}
            onChange={(e) => setCopyGlobs(e.target.value)}
            spellCheck={false}
            className="rounded-md border border-border bg-bg-inset px-2.5 py-1.5 font-mono text-xs text-fg outline-none focus:border-accent"
          />
          <span className="text-[11px] text-fg-subtle">{t("create.copyHint")}</span>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-fg-muted">{t("create.agent")}</span>
          <Combobox
            ariaLabel={t("create.agent")}
            value={agent ?? t("create.agentNone")}
            options={AGENT_OPTIONS.map((option) => option ?? t("create.agentNone"))}
            onChange={(value) =>
              setAgent(value === t("create.agentNone") ? null : (value as AgentKind))
            }
          />
        </label>
      </div>

      {failure && (
        <p
          role="alert"
          className="whitespace-pre-wrap break-words rounded-md bg-danger/10 px-2.5 py-2 font-mono text-[11px] text-danger"
        >
          {failure}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onDone}
          className="rounded-md px-3 py-1.5 text-xs text-fg-muted transition-colors hover:text-fg"
        >
          {t("create.cancel")}
        </button>
        {/* The label says what is happening; the accessible name stays put, so
            the button does not rename itself out from under a screen reader
            halfway through its own action. */}
        <button
          type="submit"
          disabled={!path || busy}
          aria-label={t("create.create")}
          aria-busy={busy}
          className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-bg transition-opacity disabled:opacity-40"
        >
          {busy ? t("create.creating") : t("create.create")}
        </button>
      </div>
    </form>
  );
}
