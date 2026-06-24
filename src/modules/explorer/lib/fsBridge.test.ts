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
vi.mock("@/modules/ssh/lib/sftp-bridge", () => ({
  sftpReadDir: (...a: unknown[]) => sftpReadDir(...a),
  sftpReadFile: (...a: unknown[]) => sftpReadFile(...a),
  sftpWriteFile: (...a: unknown[]) => sftpWriteFile(...a),
}));

import { fsReadDir, fsReadFile, fsWriteFile } from "./fsBridge";

beforeEach(() => {
  invoke.mockReset();
  ensure.mockReset();
  sftpReadDir.mockReset();
  sftpReadFile.mockReset();
  sftpWriteFile.mockReset();
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
