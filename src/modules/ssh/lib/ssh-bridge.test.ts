import { describe, expect, it, vi } from "vitest";

const invoke = vi.fn().mockResolvedValue(7);
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...a: unknown[]) => invoke(...a),
  Channel: class { onmessage: ((m: unknown) => void) | null = null; },
}));

import { openSsh, startForward, stopForward } from "./ssh-bridge";
import { useSettingsStore } from "@/stores/settingsStore";

describe("openSsh", () => {
  it("invokes ssh_open and exposes write/resize/close on the returned id", async () => {
    const s = await openSsh({
      connectionId: "c1", host: "h", port: 22, user: "muki",
      authMethod: "password", cols: 80, rows: 24,
      onData: () => {}, onExit: () => {},
    });
    expect(s.id).toBe(7);
    await s.write("ls\n");
    expect(invoke).toHaveBeenCalledWith("ssh_write", { id: 7, data: "ls\n" });
    await s.resize(100, 30);
    expect(invoke).toHaveBeenCalledWith("ssh_resize", { id: 7, cols: 100, rows: 30 });
  });

  it("passes the correct req shape to ssh_open", async () => {
    invoke.mockClear();
    useSettingsStore.setState({ loggingEnabled: true });
    await openSsh({
      connectionId: "conn-42", host: "example.com", port: 2222, user: "alice",
      authMethod: "keyFile", keyPath: "~/.ssh/id_ed25519", cols: 120, rows: 40,
      onData: () => {}, onExit: () => {},
    });
    expect(invoke).toHaveBeenCalledWith(
      "ssh_open",
      expect.objectContaining({
        req: {
          connectionId: "conn-42",
          host: "example.com",
          port: 2222,
          user: "alice",
          authMethod: "keyFile",
          keyPath: "~/.ssh/id_ed25519",
          cols: 120,
          rows: 40,
          forwards: [],
          logEnabled: true,
        },
      }),
    );
  });

  it("forwards loggingEnabled=false from settings store to ssh_open", async () => {
    invoke.mockClear();
    useSettingsStore.setState({ loggingEnabled: false });
    await openSsh({
      connectionId: "conn-log", host: "example.com", port: 22, user: "alice",
      authMethod: "password", cols: 80, rows: 24,
      onData: () => {}, onExit: () => {},
    });
    const call = invoke.mock.calls.find(([cmd]) => cmd === "ssh_open");
    expect((call?.[1] as { req: { logEnabled: boolean } }).req.logEnabled).toBe(false);
    useSettingsStore.setState({ loggingEnabled: true });
  });

  it("includes forwards in the req when provided", async () => {
    invoke.mockClear();
    const forwards = [
      { id: "f1", bindHost: "127.0.0.1", localPort: 5432, destHost: "localhost", destPort: 5432 },
    ];
    await openSsh({
      connectionId: "conn-42", host: "example.com", port: 2222, user: "alice",
      authMethod: "keyFile", keyPath: "~/.ssh/id_ed25519", cols: 120, rows: 40,
      forwards,
      onData: () => {}, onExit: () => {},
    });
    expect(invoke).toHaveBeenCalledWith(
      "ssh_open",
      expect.objectContaining({
        req: expect.objectContaining({
          forwards,
        }),
      }),
    );
  });

  it("close() calls ssh_close with the session id", async () => {
    invoke.mockClear();
    const s = await openSsh({
      connectionId: "c2", host: "h2", port: 22, user: "bob",
      authMethod: "password", cols: 80, rows: 24,
      onData: () => {}, onExit: () => {},
    });
    await s.close();
    expect(invoke).toHaveBeenCalledWith("ssh_close", { id: s.id });
  });
});

describe("startForward", () => {
  it("invokes ssh_forward_start with the session id and forward", async () => {
    invoke.mockClear();
    await startForward(7, { id: "f1", bindHost: "127.0.0.1", localPort: 5432, destHost: "localhost", destPort: 5432 });
    expect(invoke).toHaveBeenCalledWith("ssh_forward_start", {
      id: 7,
      forward: { id: "f1", bindHost: "127.0.0.1", localPort: 5432, destHost: "localhost", destPort: 5432 },
    });
  });
});

describe("stopForward", () => {
  it("invokes ssh_forward_stop", async () => {
    invoke.mockClear();
    await stopForward(7, "f1");
    expect(invoke).toHaveBeenCalledWith("ssh_forward_stop", { id: 7, forwardId: "f1" });
  });
});
