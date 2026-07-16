import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import type { WorktreeDetail } from "./types";
import { removalBlocker } from "./lib/removeWorktree";
import { useWorktreesStore } from "./lib/worktreesStore";

/**
 * The one place this feature can destroy something nobody can get back.
 *
 * So: the count is shown rather than the fact of there being changes, force is
 * never passed on the user's behalf, the branch is kept unless asked for, and
 * the repo's own working tree cannot be removed at all — that last one is not a
 * confirmation away, it is a no.
 */
export function RemoveWorktreeDialog({
  repoPath,
  detail,
  dirty,
  onDone,
}: {
  repoPath: string;
  detail: WorktreeDetail;
  /** Modified + untracked files, or null when the count has not landed. */
  dirty: number | null;
  onDone: () => void;
}) {
  const { t } = useTranslation("worktrees");
  const [acknowledged, setAcknowledged] = useState(false);
  const [deleteBranch, setDeleteBranch] = useState(false);
  const [forceDeleteBranch, setForceDeleteBranch] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const remove = useWorktreesStore((s) => s.remove);

  const blocker = removalBlocker({
    dirty,
    isMain: detail.isMain,
    locked: detail.locked,
    prunable: detail.prunable,
  });
  // Only `dirty` is a blocker a person can clear by saying they mean it. Being
  // the repo, or locked by someone for a reason, are answers rather than prompts.
  const needsAcknowledgement = blocker === "dirty";
  const impossible = blocker === "main" || blocker === "locked";
  const canConfirm = !busy && !impossible && (!needsAcknowledgement || acknowledged);

  const confirm = async () => {
    if (!canConfirm) {
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      await remove(repoPath, detail.path, {
        deleteBranch: deleteBranch && detail.branch ? detail.branch : undefined,
        forceDeleteBranch: deleteBranch && forceDeleteBranch,
        // Only ever from the checkbox. Never a default, never inferred.
        force: needsAcknowledgement && acknowledged,
      });
      onDone();
    } catch (error) {
      // git's own words: it knows why better than a paraphrase would.
      setFailure(typeof error === "string" ? error : ((error as Error)?.message ?? String(error)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ConfirmDialog
      title={t("remove.title")}
      message={
        impossible
          ? blocker === "main"
            ? t("remove.main")
            : t("remove.locked")
          : detail.prunable
            ? t("remove.stale")
            : t("remove.message", { path: detail.path })
      }
      confirmLabel={busy ? t("remove.removing") : t("remove.confirm")}
      cancelLabel={t("remove.cancel")}
      onConfirm={() => void confirm()}
      onCancel={onDone}
      confirmDisabled={!canConfirm}
      error={failure ?? undefined}
    >
      <div className="mt-3 flex flex-col gap-3">
        {blocker === "locked" && detail.lockReason && (
          <p className="text-sm text-warning">{t("remove.lockedReason", { reason: detail.lockReason })}</p>
        )}

        {needsAcknowledgement && !impossible && (
          <div className="flex flex-col gap-2 rounded-md border border-danger/40 bg-danger/5 px-3 py-2">
            <p className="text-sm text-danger">
              {dirty === null ? t("remove.dirtyUnknown") : t("remove.dirty", { count: dirty })}
            </p>
            <label className="flex cursor-pointer items-start gap-2 text-sm leading-snug text-fg-muted">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-[var(--color-accent)]"
              />
              {t("remove.discard")}
            </label>
          </div>
        )}

        {!impossible && detail.branch && !detail.prunable && (
          <div className="flex flex-col gap-1.5">
            <label className="flex cursor-pointer items-start gap-2 text-sm leading-snug text-fg-muted">
              <input
                type="checkbox"
                checked={deleteBranch}
                onChange={(e) => setDeleteBranch(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-[var(--color-accent)]"
              />
              {t("remove.deleteBranch", { branch: detail.branch })}
            </label>
            {deleteBranch ? (
              <label className="ml-6 flex cursor-pointer items-start gap-2 text-sm leading-snug text-fg-muted">
                <input
                  type="checkbox"
                  checked={forceDeleteBranch}
                  onChange={(e) => setForceDeleteBranch(e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-[var(--color-accent)]"
                />
                {t("remove.forceDeleteBranch")}
              </label>
            ) : (
              <p className="ml-6 text-sm text-fg-subtle">{t("remove.deleteBranchHint")}</p>
            )}
          </div>
        )}
      </div>
    </ConfirmDialog>
  );
}
