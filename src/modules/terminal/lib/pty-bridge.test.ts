import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke,
  Channel: class {
    onmessage: ((m: unknown) => void) | null = null;
  },
}));

import { closeLocalSessions, openPty } from "./pty-bridge";
import { useSettingsStore } from "@/stores/settingsStore";

const opts = { cols: 80, rows: 24, suggestions: false, onData: () => {}, onExit: () => {} };

beforeEach(() => {
  invoke.mockReset();
});

describe("pty-bridge session registry", () => {
  it("forwards the suggestions flag to pty_open so the session reflects the current setting", async () => {
    invoke.mockResolvedValueOnce(1);
    await openPty({ ...opts, suggestions: true });

    const open = invoke.mock.calls.find(([cmd]) => cmd === "pty_open");
    expect((open?.[1] as { suggestions: boolean }).suggestions).toBe(true);
  });

  it("forwards loggingEnabled=false from settings store to pty_open", async () => {
    invoke.mockResolvedValueOnce(1);
    useSettingsStore.setState({ loggingEnabled: false });
    await openPty(opts);

    const open = invoke.mock.calls.find(([cmd]) => cmd === "pty_open");
    expect((open?.[1] as { logEnabled: boolean }).logEnabled).toBe(false);
    useSettingsStore.setState({ loggingEnabled: true });
  });

  it("forwards the shell override to pty_open so the backend can spawn it", async () => {
    invoke.mockResolvedValueOnce(1);
    await openPty({ ...opts, shellOverride: "/opt/homebrew/bin/pwsh" });

    const open = invoke.mock.calls.find(([cmd]) => cmd === "pty_open");
    expect((open?.[1] as { shellOverride?: string }).shellOverride).toBe(
      "/opt/homebrew/bin/pwsh",
    );
  });

  it("closeLocalSessions closes every open session, then clears", async () => {
    invoke.mockResolvedValueOnce(1).mockResolvedValueOnce(2); // two pty_open ids
    await openPty(opts);
    await openPty(opts);

    invoke.mockResolvedValue(undefined);
    await closeLocalSessions();

    const closes = invoke.mock.calls.filter(([cmd]) => cmd === "pty_close");
    expect(closes.map(([, args]) => (args as { id: number }).id).sort()).toEqual([1, 2]);

    invoke.mockClear();
    await closeLocalSessions();
    expect(invoke).not.toHaveBeenCalled(); // registry was cleared
  });

  it("session.close() unregisters so closeLocalSessions does not re-close it", async () => {
    invoke.mockResolvedValueOnce(7);
    const session = await openPty(opts);

    invoke.mockResolvedValue(undefined);
    await session.close();
    invoke.mockClear();

    await closeLocalSessions();
    expect(invoke).not.toHaveBeenCalled();
  });
});
