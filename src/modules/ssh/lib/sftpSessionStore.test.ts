import { beforeEach, describe, expect, it, vi } from "vitest";

const sftpStart = vi.fn();
const sftpClose = vi.fn();
vi.mock("./sftp-bridge", () => ({
  sftpStart: (...a: unknown[]) => sftpStart(...a),
  sftpClose: (...a: unknown[]) => sftpClose(...a),
}));

vi.mock("@/stores/connectionsStore", () => ({
  useConnectionsStore: {
    getState: () => ({
      getConnection: (id: string) =>
        id === "c1"
          ? { id: "c1", name: "n", host: "h", port: 22, user: "me", authMethod: "agent" }
          : undefined,
    }),
  },
}));

import { sftpSessionStore } from "./sftpSessionStore";

beforeEach(() => {
  sftpStart.mockReset();
  sftpClose.mockReset();
  sftpClose.mockResolvedValue(undefined);
  sftpSessionStore.setState({ sessions: {}, pending: {} });
});

describe("sftpSessionStore", () => {
  it("opens a session once and reuses it", async () => {
    sftpStart.mockResolvedValue(7);
    const a = await sftpSessionStore.getState().ensure("c1");
    const b = await sftpSessionStore.getState().ensure("c1");
    expect(a).toBe(7);
    expect(b).toBe(7);
    expect(sftpStart).toHaveBeenCalledTimes(1);
  });

  it("dedupes concurrent opens", async () => {
    sftpStart.mockResolvedValue(7);
    const [a, b] = await Promise.all([
      sftpSessionStore.getState().ensure("c1"),
      sftpSessionStore.getState().ensure("c1"),
    ]);
    expect(a).toBe(7);
    expect(b).toBe(7);
    expect(sftpStart).toHaveBeenCalledTimes(1);
  });

  it("rejects an unknown connection", async () => {
    await expect(sftpSessionStore.getState().ensure("nope")).rejects.toThrow();
    expect(sftpStart).not.toHaveBeenCalled();
  });

  it("closes a cached session", async () => {
    sftpStart.mockResolvedValue(7);
    await sftpSessionStore.getState().ensure("c1");
    sftpSessionStore.getState().closeFor("c1");
    expect(sftpClose).toHaveBeenCalledWith(7);
    expect(sftpSessionStore.getState().sessions.c1).toBeUndefined();
  });

  it("closes a session that finishes opening after closeAll", async () => {
    let resolveStart!: (id: number) => void;
    sftpStart.mockReturnValue(
      new Promise<number>((resolve) => {
        resolveStart = resolve;
      }),
    );
    const open = sftpSessionStore.getState().ensure("c1");
    // Tear everything down while the connect is still in flight.
    sftpSessionStore.getState().closeAll();
    resolveStart(7);
    await open;
    expect(sftpClose).toHaveBeenCalledWith(7);
    expect(sftpSessionStore.getState().sessions.c1).toBeUndefined();
  });

  it("closes a session that finishes opening after closeFor", async () => {
    let resolveStart!: (id: number) => void;
    sftpStart.mockReturnValue(
      new Promise<number>((resolve) => {
        resolveStart = resolve;
      }),
    );
    const open = sftpSessionStore.getState().ensure("c1");
    sftpSessionStore.getState().closeFor("c1");
    resolveStart(7);
    await open;
    expect(sftpClose).toHaveBeenCalledWith(7);
    expect(sftpSessionStore.getState().sessions.c1).toBeUndefined();
  });

  it("keeps only the latest open when a connection is reopened mid-flight", async () => {
    let resolveStale!: (id: number) => void;
    let resolveFresh!: (id: number) => void;
    sftpStart
      .mockReturnValueOnce(
        new Promise<number>((resolve) => {
          resolveStale = resolve;
        }),
      )
      .mockReturnValueOnce(
        new Promise<number>((resolve) => {
          resolveFresh = resolve;
        }),
      );
    const stale = sftpSessionStore.getState().ensure("c1");
    sftpSessionStore.getState().closeFor("c1");
    const fresh = sftpSessionStore.getState().ensure("c1");
    // The discarded open resolves first, then the one we actually want.
    resolveStale(1);
    resolveFresh(2);
    await Promise.all([stale, fresh]);
    expect(sftpClose).toHaveBeenCalledWith(1);
    expect(sftpClose).not.toHaveBeenCalledWith(2);
    expect(sftpSessionStore.getState().sessions.c1).toBe(2);
  });
});
