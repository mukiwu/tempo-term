import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));

import {
  sftpCreateDir,
  sftpCreateFile,
  sftpDelete,
  sftpReadDir,
  sftpRename,
  sftpStart,
  sftpWriteFile,
} from "./sftp-bridge";

beforeEach(() => invoke.mockReset());

describe("sftp-bridge", () => {
  it("starts a session with the connection fields", async () => {
    invoke.mockResolvedValue(7);
    const id = await sftpStart({
      connectionId: "c1",
      host: "h",
      port: 22,
      user: "me",
      authMethod: "agent",
    });
    expect(id).toBe(7);
    expect(invoke).toHaveBeenCalledWith("sftp_start", {
      req: { connectionId: "c1", host: "h", port: 22, user: "me", authMethod: "agent" },
    });
  });

  it("lists a remote directory by session id and path", async () => {
    invoke.mockResolvedValue([{ name: "a", path: "/a", is_dir: true, size: 0 }]);
    const entries = await sftpReadDir(7, "/home");
    expect(entries).toHaveLength(1);
    expect(invoke).toHaveBeenCalledWith("sftp_read_dir", { id: 7, path: "/home" });
  });

  it("writes a remote file", async () => {
    invoke.mockResolvedValue(undefined);
    await sftpWriteFile(7, "/a.txt", "hi");
    expect(invoke).toHaveBeenCalledWith("sftp_write_file", {
      id: 7,
      path: "/a.txt",
      contents: "hi",
    });
  });
});

describe("sftp write ops", () => {
  it("invokes sftp_create_file / sftp_create_dir with id and path", async () => {
    await sftpCreateFile(7, "/home/me/x.txt");
    expect(invoke).toHaveBeenCalledWith("sftp_create_file", { id: 7, path: "/home/me/x.txt" });
    await sftpCreateDir(7, "/home/me/dir");
    expect(invoke).toHaveBeenCalledWith("sftp_create_dir", { id: 7, path: "/home/me/dir" });
  });

  it("invokes sftp_delete with the entry kind", async () => {
    await sftpDelete(7, "/home/me/dir", true);
    expect(invoke).toHaveBeenCalledWith("sftp_delete", { id: 7, path: "/home/me/dir", isDir: true });
  });

  it("invokes sftp_rename with both paths", async () => {
    await sftpRename(7, "/a/old.txt", "/a/new.txt");
    expect(invoke).toHaveBeenCalledWith("sftp_rename", { id: 7, from: "/a/old.txt", to: "/a/new.txt" });
  });
});
