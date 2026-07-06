import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));

const ensure = vi.fn();
vi.mock("@/modules/ssh/lib/sftpSessionStore", () => ({
  sftpSessionStore: { getState: () => ({ ensure }) },
}));

const sftpReadDir = vi.fn();
const sftpReadFile = vi.fn();
const sftpWriteFile = vi.fn();
const sftpCreateFile = vi.fn();
const sftpCreateDir = vi.fn();
const sftpDelete = vi.fn();
const sftpRename = vi.fn();
vi.mock("@/modules/ssh/lib/sftp-bridge", () => ({
  sftpReadDir: (...a: unknown[]) => sftpReadDir(...a),
  sftpReadFile: (...a: unknown[]) => sftpReadFile(...a),
  sftpWriteFile: (...a: unknown[]) => sftpWriteFile(...a),
  sftpCreateFile: (...a: unknown[]) => sftpCreateFile(...a),
  sftpCreateDir: (...a: unknown[]) => sftpCreateDir(...a),
  sftpDelete: (...a: unknown[]) => sftpDelete(...a),
  sftpRename: (...a: unknown[]) => sftpRename(...a),
}));

import { canSearchRoot, fsCreateDir, fsCreateFile, fsDelete, fsReadDir, fsReadFile, fsRename, fsWriteFile } from "./fsBridge";

beforeEach(() => {
  invoke.mockReset();
  ensure.mockReset();
  sftpReadDir.mockReset();
  sftpReadFile.mockReset();
  sftpWriteFile.mockReset();
  sftpCreateFile.mockReset();
  sftpCreateDir.mockReset();
  sftpDelete.mockReset();
  sftpRename.mockReset();
});

describe("fsBridge routing", () => {
  it("reads a local directory through fs_read_dir", async () => {
    invoke.mockResolvedValue([]);
    await fsReadDir("/home/me");
    expect(invoke).toHaveBeenCalledWith("fs_read_dir", { path: "/home/me" });
    expect(ensure).not.toHaveBeenCalled();
  });

  it("reads a remote directory over sftp and wraps entry paths as uris", async () => {
    ensure.mockResolvedValue(7);
    sftpReadDir.mockResolvedValue([{ name: "sub", path: "/home/me/sub", is_dir: true, size: 0 }]);
    const entries = await fsReadDir("ssh://c1/home/me");
    expect(ensure).toHaveBeenCalledWith("c1");
    expect(sftpReadDir).toHaveBeenCalledWith(7, "/home/me");
    expect(entries[0].path).toBe("ssh://c1/home/me/sub");
  });

  it("reads and writes a remote file over sftp", async () => {
    ensure.mockResolvedValue(7);
    sftpReadFile.mockResolvedValue("body");
    sftpWriteFile.mockResolvedValue(undefined);
    expect(await fsReadFile("ssh://c1/a.txt")).toBe("body");
    expect(sftpReadFile).toHaveBeenCalledWith(7, "/a.txt");
    await fsWriteFile("ssh://c1/a.txt", "new");
    expect(sftpWriteFile).toHaveBeenCalledWith(7, "/a.txt", "new");
  });

  it("writes a local file through fs_write_file", async () => {
    invoke.mockResolvedValue(undefined);
    await fsWriteFile("/a.txt", "x");
    expect(invoke).toHaveBeenCalledWith("fs_write_file", { path: "/a.txt", contents: "x" });
  });
});

describe("canSearchRoot", () => {
  it("allows a local root", () => {
    expect(canSearchRoot("/home/me/project")).toBe(true);
  });

  it("rejects a remote (SFTP) root — fs_list_files only understands local paths", () => {
    expect(canSearchRoot("ssh://c1/home/me")).toBe(false);
  });

  it("rejects no open folder", () => {
    expect(canSearchRoot(null)).toBe(false);
  });
});

describe("fsBridge write-op routing", () => {
  it("creates local entries through fs_create_file / fs_create_dir", async () => {
    invoke.mockResolvedValue(undefined);
    await fsCreateFile("/p/x.txt");
    expect(invoke).toHaveBeenCalledWith("fs_create_file", { path: "/p/x.txt" });
    await fsCreateDir("/p/dir");
    expect(invoke).toHaveBeenCalledWith("fs_create_dir", { path: "/p/dir" });
  });

  it("creates remote entries over sftp", async () => {
    ensure.mockResolvedValue(7);
    await fsCreateFile("ssh://c1/home/me/x.txt");
    expect(sftpCreateFile).toHaveBeenCalledWith(7, "/home/me/x.txt");
    await fsCreateDir("ssh://c1/home/me/dir");
    expect(sftpCreateDir).toHaveBeenCalledWith(7, "/home/me/dir");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("deletes locally through fs_delete, ignoring isDir", async () => {
    invoke.mockResolvedValue(undefined);
    await fsDelete("/p/dir", true);
    expect(invoke).toHaveBeenCalledWith("fs_delete", { path: "/p/dir" });
  });

  it("deletes remotely over sftp, passing the entry kind through", async () => {
    ensure.mockResolvedValue(7);
    await fsDelete("ssh://c1/home/me/dir", true);
    expect(sftpDelete).toHaveBeenCalledWith(7, "/home/me/dir", true);
  });

  it("renames locally through fs_rename", async () => {
    invoke.mockResolvedValue(undefined);
    await fsRename("/p/a.txt", "/p/b.txt");
    expect(invoke).toHaveBeenCalledWith("fs_rename", { from: "/p/a.txt", to: "/p/b.txt" });
  });

  it("renames remotely over sftp with both paths unwrapped", async () => {
    ensure.mockResolvedValue(7);
    await fsRename("ssh://c1/a/old.txt", "ssh://c1/a/new.txt");
    expect(sftpRename).toHaveBeenCalledWith(7, "/a/old.txt", "/a/new.txt");
  });

  it("rejects a rename that crosses hosts", async () => {
    await expect(fsRename("ssh://c1/a.txt", "ssh://c2/a.txt")).rejects.toThrow();
    expect(sftpRename).not.toHaveBeenCalled();
  });

  it("rejects a rename that mixes local and remote paths", async () => {
    await expect(fsRename("/p/a.txt", "ssh://c1/a.txt")).rejects.toThrow();
    await expect(fsRename("ssh://c1/a.txt", "/p/a.txt")).rejects.toThrow();
    expect(sftpRename).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });
});
