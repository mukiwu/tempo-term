import { invoke } from "@tauri-apps/api/core";
import { buildRemoteUri, isRemoteUri, parseRemoteUri } from "@/modules/ssh/lib/remotePath";
import { sftpReadDir, sftpReadFile, sftpWriteFile, sftpCreateFile, sftpCreateDir, sftpDelete, sftpRename } from "@/modules/ssh/lib/sftp-bridge";
import { sftpSessionStore } from "@/modules/ssh/lib/sftpSessionStore";

export interface DirEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
}

export interface GrepMatch {
  path: string;
  line_number: number;
  line: string;
}

export function fsHomeDir(): Promise<string> {
  return invoke<string>("fs_home_dir");
}

export async function fsReadDir(path: string): Promise<DirEntry[]> {
  const remote = parseRemoteUri(path);
  if (remote) {
    const id = await sftpSessionStore.getState().ensure(remote.connectionId);
    const entries = await sftpReadDir(id, remote.path);
    return entries.map((e) => ({ ...e, path: buildRemoteUri(remote.connectionId, e.path) }));
  }
  return invoke<DirEntry[]>("fs_read_dir", { path });
}

export async function fsReadFile(path: string): Promise<string> {
  const remote = parseRemoteUri(path);
  if (remote) {
    const id = await sftpSessionStore.getState().ensure(remote.connectionId);
    return sftpReadFile(id, remote.path);
  }
  return invoke<string>("fs_read_file", { path });
}

export async function fsWriteFile(path: string, contents: string): Promise<void> {
  const remote = parseRemoteUri(path);
  if (remote) {
    const id = await sftpSessionStore.getState().ensure(remote.connectionId);
    return sftpWriteFile(id, remote.path, contents);
  }
  return invoke("fs_write_file", { path, contents });
}

export function fsListFiles(root: string, limit?: number): Promise<string[]> {
  return invoke<string[]>("fs_list_files", { root, limit });
}

/** Whether `root` is a local folder `fsListFiles` can search — it has no SFTP
 *  support, so a remote root (or no open folder at all) is not searchable. */
export function canSearchRoot(root: string | null): root is string {
  return root !== null && !isRemoteUri(root);
}

export function fsGrep(
  root: string,
  query: string,
  limit?: number,
): Promise<GrepMatch[]> {
  return invoke<GrepMatch[]>("fs_grep", { root, query, limit });
}

export async function fsCreateFile(path: string): Promise<void> {
  const remote = parseRemoteUri(path);
  if (remote) {
    const id = await sftpSessionStore.getState().ensure(remote.connectionId);
    return sftpCreateFile(id, remote.path);
  }
  return invoke("fs_create_file", { path });
}

export async function fsCreateDir(path: string): Promise<void> {
  const remote = parseRemoteUri(path);
  if (remote) {
    const id = await sftpSessionStore.getState().ensure(remote.connectionId);
    return sftpCreateDir(id, remote.path);
  }
  return invoke("fs_create_dir", { path });
}

/** `isDir` is only consulted on the remote branch — SFTP deletes files and
 *  directories with different calls, and the caller already knows the kind
 *  from the DirEntry it is deleting. The local `fs_delete` infers it itself. */
export async function fsDelete(path: string, isDir: boolean): Promise<void> {
  const remote = parseRemoteUri(path);
  if (remote) {
    const id = await sftpSessionStore.getState().ensure(remote.connectionId);
    return sftpDelete(id, remote.path, isDir);
  }
  return invoke("fs_delete", { path });
}

export async function fsRename(from: string, to: string): Promise<void> {
  const fromRemote = parseRemoteUri(from);
  const toRemote = parseRemoteUri(to);
  if (fromRemote || toRemote) {
    if (!fromRemote || !toRemote || fromRemote.connectionId !== toRemote.connectionId) {
      throw new Error("cannot rename across hosts");
    }
    const id = await sftpSessionStore.getState().ensure(fromRemote.connectionId);
    return sftpRename(id, fromRemote.path, toRemote.path);
  }
  return invoke("fs_rename", { from, to });
}

export function fsReveal(path: string): Promise<void> {
  return invoke("fs_reveal", { path });
}
