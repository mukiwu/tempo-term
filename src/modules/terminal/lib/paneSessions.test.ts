import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import {
  registerPaneSession,
  unregisterPaneSession,
  panesWouldInterrupt,
} from "./paneSessions";
import { useSettingsStore } from "@/stores/settingsStore";

const term = (id: string) => ({ id, content: { kind: "terminal" } as const });
const sshPane = (id: string) => ({
  id,
  content: { kind: "terminal", ssh: { connectionId: "c1" } } as const,
});

beforeEach(() => {
  invoke.mockReset();
  useSettingsStore.setState({ confirmCloseWithRunningTerminals: true });
  unregisterPaneSession("p1");
  unregisterPaneSession("p2");
});

describe("panesWouldInterrupt", () => {
  it("never interrupts when the setting is off, and asks nothing", async () => {
    useSettingsStore.setState({ confirmCloseWithRunningTerminals: false });
    registerPaneSession("p1", 7);
    expect(panesWouldInterrupt([term("p1")])).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("treats an ssh pane as busy without asking the backend", async () => {
    expect(panesWouldInterrupt([sshPane("p1")])).toBe(true);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("asks the backend about registered ptys and follows its verdict", async () => {
    registerPaneSession("p1", 7);
    invoke.mockResolvedValue(true);
    await expect(panesWouldInterrupt([term("p1"), term("p2")])).resolves.toBe(true);
    expect(invoke).toHaveBeenCalledWith("pty_sessions_busy", { ids: [7] });

    invoke.mockResolvedValue(false);
    await expect(panesWouldInterrupt([term("p1")])).resolves.toBe(false);
  });

  it("skips IPC entirely when no pane has a live pty", async () => {
    expect(panesWouldInterrupt([term("p1")])).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("forgets a pane once unregistered", () => {
    registerPaneSession("p1", 7);
    unregisterPaneSession("p1");
    expect(panesWouldInterrupt([term("p1")])).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("editor and preview panes never count", () => {
    expect(
      panesWouldInterrupt([{ id: "p1", content: { kind: "editor", path: "/a" } }]),
    ).toBe(false);
  });
});
