import { useEffect, useState } from "react";
import type { Crumb } from "@/lib/breadcrumb";
import { fsHomeDir, fsReadDir } from "@/modules/explorer/lib/fsBridge";
import { dirname } from "@/modules/explorer/lib/paths";
import { buildRemoteUri, parseRemoteUri } from "@/modules/ssh/lib/remotePath";
import { sftpSessionStore } from "@/modules/ssh/lib/sftpSessionStore";
import { sftpHome } from "@/modules/ssh/lib/sftp-bridge";

/** Remote homes, cached per connection — they cannot change mid-session. */
const remoteHomes = new Map<string, string>();
/** The local home, cached after the first lookup — it cannot change either. */
let localHome: string | null = null;

function cachedHome(sshConnectionId: string | undefined): string | null {
  return sshConnectionId ? (remoteHomes.get(sshConnectionId) ?? null) : localHome;
}

/**
 * The home directory a pane's breadcrumb should be relative to: local for a
 * local path, the remote user's for an SSH pane (via its SFTP session). Null
 * until known — the trail then shows absolute paths, which is only a flash.
 */
export function useHomeDir(sshConnectionId: string | undefined): string | null {
  const [home, setHome] = useState<string | null>(cachedHome(sshConnectionId));

  useEffect(() => {
    let cancelled = false;
    // Reset synchronously when the connection changes (a pane can swap its
    // content without remounting), so the trail never renders against the
    // previous connection's home while the new one resolves.
    setHome(cachedHome(sshConnectionId));
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
      : fsHomeDir().then((dir) => {
          localHome = dir;
          return dir;
        });
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

async function listEntries(
  dirPath: string,
  keep: "dirs" | "files",
  sshConnectionId?: string,
): Promise<Crumb[]> {
  const entries = await fsReadDir(
    sshConnectionId ? buildRemoteUri(sshConnectionId, dirPath) : dirPath,
  );
  return entries
    .filter((entry) => (keep === "dirs" ? entry.is_dir : !entry.is_dir))
    .map((entry) => ({
      label: entry.name,
      // Remote entries come back as ssh:// uris; cd (and the editor) want the
      // plain path.
      path: parseRemoteUri(entry.path)?.path ?? entry.path,
    }));
}

/** A directory's subdirectories — the terminal tree menu's next level down. */
export function listSubdirectories(dirPath: string, sshConnectionId?: string): Promise<Crumb[]> {
  return listEntries(dirPath, "dirs", sshConnectionId);
}

/** The files sharing a file's folder — the editor's filename-segment menu. */
export function listSiblingFiles(filePath: string, sshConnectionId?: string): Promise<Crumb[]> {
  return listEntries(dirname(filePath), "files", sshConnectionId);
}
