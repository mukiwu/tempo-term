import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));

import { sftpReadDir, sftpStart, sftpWriteFile } from "./sftp-bridge";

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
