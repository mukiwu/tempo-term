import { invoke } from "@tauri-apps/api/core";
import type { DirEntry } from "@/modules/explorer/lib/fsBridge";

export interface SftpStartInput {
  connectionId: string;
  host: string;
  port: number;
  user: string;
  authMethod: string;
  keyPath?: string;
}

export function sftpStart(req: SftpStartInput): Promise<number> {
  return invoke<number>("sftp_start", { req });
}

export function sftpHome(id: number): Promise<string> {
  return invoke<string>("sftp_home", { id });
}

export function sftpReadDir(id: number, path: string): Promise<DirEntry[]> {
  return invoke<DirEntry[]>("sftp_read_dir", { id, path });
}

export function sftpReadFile(id: number, path: string): Promise<string> {
  return invoke<string>("sftp_read_file", { id, path });
}

export function sftpWriteFile(id: number, path: string, contents: string): Promise<void> {
  return invoke("sftp_write_file", { id, path, contents });
}

export function sftpClose(id: number): Promise<void> {
  return invoke("sftp_close", { id });
}

export function sftpCreateFile(id: number, path: string): Promise<void> {
  return invoke("sftp_create_file", { id, path });
}

export function sftpCreateDir(id: number, path: string): Promise<void> {
  return invoke("sftp_create_dir", { id, path });
}

export function sftpDelete(id: number, path: string, isDir: boolean): Promise<void> {
  return invoke("sftp_delete", { id, path, isDir });
}

export function sftpRename(id: number, from: string, to: string): Promise<void> {
  return invoke("sftp_rename", { id, from, to });
}
