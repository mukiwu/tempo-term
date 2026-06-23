import { describe, expect, it, vi } from "vitest";

const invoke = vi.fn().mockResolvedValue(7);
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...a: unknown[]) => invoke(...a),
  Channel: class { onmessage: ((m: unknown) => void) | null = null; },
}));

import { openSsh } from "./ssh-bridge";

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
});
