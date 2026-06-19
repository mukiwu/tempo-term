import { invoke } from "@tauri-apps/api/core";

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

export function fsReadDir(path: string): Promise<DirEntry[]> {
  return invoke<DirEntry[]>("fs_read_dir", { path });
}

export function fsReadFile(path: string): Promise<string> {
  return invoke<string>("fs_read_file", { path });
}

export function fsWriteFile(path: string, contents: string): Promise<void> {
  return invoke("fs_write_file", { path, contents });
}

export function fsListFiles(root: string, limit?: number): Promise<string[]> {
  return invoke<string[]>("fs_list_files", { root, limit });
}

export function fsGrep(
  root: string,
  query: string,
  limit?: number,
): Promise<GrepMatch[]> {
  return invoke<GrepMatch[]>("fs_grep", { root, query, limit });
}

export function fsCreateFile(path: string): Promise<void> {
  return invoke("fs_create_file", { path });
}

export function fsCreateDir(path: string): Promise<void> {
  return invoke("fs_create_dir", { path });
}

export function fsDelete(path: string): Promise<void> {
  return invoke("fs_delete", { path });
}

export function fsRename(from: string, to: string): Promise<void> {
  return invoke("fs_rename", { from, to });
}

export function fsReveal(path: string): Promise<void> {
  return invoke("fs_reveal", { path });
}
