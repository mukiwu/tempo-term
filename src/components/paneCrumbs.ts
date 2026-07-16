import { useEffect, useState } from "react";
import type { Crumb } from "@/lib/breadcrumb";
import { fsHomeDir, fsReadDir } from "@/modules/explorer/lib/fsBridge";
import { dirname } from "@/modules/explorer/lib/paths";
import { buildRemoteUri, parseRemoteUri } from "@/modules/ssh/lib/remotePath";
import { sftpSessionStore } from "@/modules/ssh/lib/sftpSessionStore";
import { sftpHome } from "@/modules/ssh/lib/sftp-bridge";

/** Remote homes, cached per connection — they cannot change mid-session. */
const remoteHomes = new Map<string, string>();

/**
 * The home directory a pane's breadcrumb should be relative to: local for a
 * local path, the remote user's for an SSH pane (via its SFTP session). Null
 * until known — the trail then shows absolute paths, which is only a flash.
 */
export function useHomeDir(sshConnectionId: string | undefined): string | null {
  const [home, setHome] = useState<string | null>(
    sshConnectionId ? (remoteHomes.get(sshConnectionId) ?? null) : null,
  );

  useEffect(() => {
    let cancelled = false;
    const resolve = sshConnectionId
      ? remoteHomes.has(sshConnectionId)
        ? Promise.resolve(remoteHomes.get(sshConnectionId)!)
        : sftpSessionStore
            .getState()
            .ensure(sshConnectionId)
            .then((id) => sftpHome(id))
            .then((dir) => {
              remoteHomes.set(sshConnectionId, dir);
              return dir;
            })
      : fsHomeDir();
    resolve
      .then((dir) => {
        if (!cancelled) {
          setHome(dir);
        }
      })
      // Unknown home just means the trail stays absolute — never an error.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [sshConnectionId]);

  return home;
}

/**
 * A crumb's siblings: the entries sharing its parent directory. A terminal
 * lists directories (cd targets); an editor lists files (things a pane can
 * show). Remote crumbs are read through the connection's SFTP session, and
 * come back as plain remote paths either way.
 */
export async function loadCrumbSiblings(
  crumb: Crumb,
  kind: "dirs" | "files",
  sshConnectionId?: string,
): Promise<Crumb[]> {
  const parent = dirname(crumb.path);
  const entries = await fsReadDir(
    sshConnectionId ? buildRemoteUri(sshConnectionId, parent) : parent,
  );
  return entries
    .filter((entry) => (kind === "dirs" ? entry.is_dir : !entry.is_dir))
    .map((entry) => ({
      label: entry.name,
      path: parseRemoteUri(entry.path)?.path ?? entry.path,
    }));
}
