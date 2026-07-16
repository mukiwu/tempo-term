import { PaneHeader } from "@/components/PaneHeader";
import { Breadcrumb } from "@/components/Breadcrumb";
import { Tooltip } from "@/components/Tooltip";
import { buildCrumbs } from "@/lib/breadcrumb";
import { listSubdirectories, useHomeDir } from "@/components/paneCrumbs";
import { shellQuotePath } from "@/modules/explorer/lib/dragEntry";
import { PaneWorktreeMenu, usePaneRepoPath } from "@/modules/worktrees/PaneWorktreeMenu";
import { writeToTerminal } from "./lib/terminalBus";

/**
 * A terminal pane's header: where its shell is, and what you can do to it.
 *
 * The breadcrumb replaces the old bare directory name. Clicking a segment
 * lists that segment's sibling directories; choosing one cds this pane's
 * shell there (see docs/adr 0001 — the menu switches the pane, never opens a
 * tab). An SSH pane gets the same treatment through its SFTP session; only
 * the worktree menu is local-only, since a local worktree means nothing to a
 * shell on another machine.
 */
export function TerminalPaneHeader({
  cwd,
  sshConnectionId,
  leafId,
  showClose,
  onClose,
}: {
  cwd: string | undefined;
  /** Set for an SSH pane; its cwd is a path on the remote machine. */
  sshConnectionId?: string;
  leafId: string;
  showClose: boolean;
  onClose: () => void;
}) {
  const repoPath = usePaneRepoPath(sshConnectionId ? undefined : cwd);
  const homeDir = useHomeDir(sshConnectionId);
  const crumbs = cwd ? buildCrumbs(cwd, { homeDir }) : [];

  return (
    <PaneHeader
      left={
        crumbs.length > 0 ? (
          <Tooltip label={cwd!} className="min-w-0">
            <Breadcrumb
              crumbs={crumbs}
              menu={{
                kind: "tree",
                loadChildren: (path) => listSubdirectories(path, sshConnectionId),
              }}
              onSelect={(path) => writeToTerminal(leafId, `cd ${shellQuotePath(path)}\r`)}
            />
          </Tooltip>
        ) : undefined
      }
      actions={repoPath ? <PaneWorktreeMenu repoPath={repoPath} /> : undefined}
      showClose={showClose}
      onClose={onClose}
    />
  );
}
