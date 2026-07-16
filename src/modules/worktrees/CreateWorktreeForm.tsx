import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useTabsStore } from "@/stores/tabsStore";
import { useWorktreeSettingsStore } from "@/stores/worktreeSettingsStore";
import { useWorktreesStore } from "./lib/worktreesStore";
import { branchNameError, worktreePathFor } from "./lib/worktreePath";

/**
 * Name a branch, get a worktree.
 *
 * The resolved path is shown while the name is typed, before anything is
 * created: a worktree is a real directory that will sit on disk carrying its own
 * `node_modules`, and being surprised by where it went is the kind of thing that
 * gets found out much later, by a full disk.
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
  const container = useWorktreeSettingsStore((s) => s.byRepo[repoPath]?.containerPath);

  const nameError = branchNameError(branch);
  // An empty field is the starting state, not a mistake — say nothing until they
  // have typed something that cannot work.
  const shownError = branch.trim() && nameError ? nameError : null;
  const path = useMemo(
    () => (nameError ? null : worktreePathFor(repoPath, branch.trim(), container)),
    [repoPath, branch, container, nameError],
  );

  const submit = async () => {
    if (!path || busy) {
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      const result = await create(repoPath, branch.trim(), path);
      // Where git says it landed, not where we predicted — the two can differ
      // once the path has been canonicalized.
      useTabsStore.getState().newTerminalTab(result.path);
      onDone();
    } catch (error) {
      // git's own words. It knows things this side does not: an existing branch,
      // an occupied directory, a repo mid-rebase.
      setFailure(typeof error === "string" ? error : ((error as Error)?.message ?? String(error)));
    } finally {
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

      {failure && (
        <p role="alert" className="whitespace-pre-wrap break-words rounded-md bg-danger/10 px-2.5 py-2 font-mono text-[11px] text-danger">
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
