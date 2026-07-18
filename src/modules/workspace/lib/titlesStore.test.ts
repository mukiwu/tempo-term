import { beforeEach, describe, expect, it, vi } from "vitest";
import { progressKey } from "@/modules/claude-progress/lib/progressStore";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { titleKey, useTitlesStore } from "./titlesStore";

beforeEach(() => {
  useTitlesStore.setState({ titles: {}, fetchedFingerprints: {}, inFlight: {} });
  invoke.mockReset();
  invoke.mockImplementation(async (command: string) =>
    command === "codex_session_title" ? "Codex title" : "Claude title",
  );
});

describe("titleKey", () => {
  it("uses the legacy progress key when there is no session id", () => {
    expect(titleKey({ cwd: "/p", agent: "claude" })).toBe(progressKey("/p", "claude"));
  });

  it("appends the session id when one is known", () => {
    expect(titleKey({ cwd: "/p", agent: "claude", sessionId: "session-a" })).toBe(
      "claude:/p:session-a",
    );
  });
});

describe("titlesStore", () => {
  it("keys a Claude and a Codex title for the same cwd separately", async () => {
    await useTitlesStore.getState().refresh([
      { cwd: "/p", agent: "claude", fingerprint: "0|0" },
      { cwd: "/p", agent: "codex", fingerprint: "0|0" },
    ]);

    const { titles } = useTitlesStore.getState();
    expect(titles[progressKey("/p", "claude")]).toBe("Claude title");
    expect(titles[progressKey("/p", "codex")]).toBe("Codex title");
  });

  it("fetches and stores distinct Claude titles for sessions sharing one cwd", async () => {
    invoke.mockImplementation(
      async (command: string, args: { sessionId?: string } | undefined) => {
        if (command !== "claude_session_title") {
          return "Codex title";
        }
        return args?.sessionId === "session-a" ? "Title A" : "Title B";
      },
    );

    const sessionA = { cwd: "/p", agent: "claude" as const, sessionId: "session-a" };
    const sessionB = { cwd: "/p", agent: "claude" as const, sessionId: "session-b" };
    await useTitlesStore.getState().refresh([
      { ...sessionA, fingerprint: "0|0" },
      { ...sessionB, fingerprint: "0|0" },
    ]);

    expect(invoke).toHaveBeenCalledWith("claude_session_title", {
      cwd: "/p",
      sessionId: "session-a",
    });
    expect(invoke).toHaveBeenCalledWith("claude_session_title", {
      cwd: "/p",
      sessionId: "session-b",
    });
    const { titles } = useTitlesStore.getState();
    expect(titles[titleKey(sessionA)]).toBe("Title A");
    expect(titles[titleKey(sessionB)]).toBe("Title B");
  });

  it("skips IPC calls for targets already fetched at the same fingerprint", async () => {
    await useTitlesStore
      .getState()
      .refresh([{ cwd: "/p", agent: "claude", fingerprint: "1|2" }]);
    invoke.mockClear();
    await useTitlesStore
      .getState()
      .refresh([{ cwd: "/p", agent: "claude", fingerprint: "1|2" }]);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("refetches once on any fingerprint change, in either direction", async () => {
    // Fingerprints are compared for equality, never ordered: a pane leaving a
    // shared key can shrink the stamp, and that still means exactly one
    // refetch — not a suppression window, not a loop.
    await useTitlesStore
      .getState()
      .refresh([{ cwd: "/p", agent: "claude", fingerprint: "0|44" }]);
    invoke.mockClear();

    await useTitlesStore
      .getState()
      .refresh([{ cwd: "/p", agent: "claude", fingerprint: "0|6" }]);
    expect(invoke).toHaveBeenCalledTimes(1);
    invoke.mockClear();

    await useTitlesStore
      .getState()
      .refresh([{ cwd: "/p", agent: "claude", fingerprint: "0|6" }]);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("does not launch a second fetch for the same fingerprint while in flight", async () => {
    let release: (value: string) => void = () => {};
    const slow = new Promise<string>((resolve) => {
      release = resolve;
    });
    invoke.mockImplementationOnce(() => slow);

    const target = { cwd: "/p", agent: "claude" as const, sessionId: "s" };
    const first = useTitlesStore.getState().refresh([{ ...target, fingerprint: "a" }]);
    const second = useTitlesStore.getState().refresh([{ ...target, fingerprint: "a" }]);
    await second;
    expect(invoke).toHaveBeenCalledTimes(1);
    release("Title");
    await first;
    expect(useTitlesStore.getState().titles[titleKey(target)]).toBe("Title");
  });

  it("a fingerprint change supersedes the fetch in flight", async () => {
    // Landings never re-fire the caller's effect, so if a changed fingerprint
    // were merely skipped while the old fetch is in flight, nothing would ever
    // fetch it — the old fetch would land its stale stamp and the title would
    // stay wrong until some unrelated later transition.
    let releaseOld: (value: string) => void = () => {};
    const old = new Promise<string>((resolve) => {
      releaseOld = resolve;
    });
    invoke
      .mockImplementationOnce(() => old)
      .mockImplementationOnce(async () => "New");

    const target = { cwd: "/p", agent: "claude" as const, sessionId: "s" };
    const first = useTitlesStore.getState().refresh([{ ...target, fingerprint: "a" }]);
    const second = useTitlesStore.getState().refresh([{ ...target, fingerprint: "b" }]);
    await second;
    expect(invoke).toHaveBeenCalledTimes(2);

    releaseOld("Old");
    await first;

    const state = useTitlesStore.getState();
    expect(state.titles[titleKey(target)]).toBe("New");
    expect(state.fetchedFingerprints[titleKey(target)]).toBe("b");
  });

  it("cancels an in-flight fetch when the fingerprint reverts to the cached one", async () => {
    // Cache holds f1; a fetch for f2 is in flight; the pane that produced f2
    // leaves again so the current stamp is back to f1. The cache answers f1,
    // and the unwanted f2 fetch must not land its bookkeeping later.
    const target = { cwd: "/p", agent: "claude" as const, sessionId: "s" };
    await useTitlesStore.getState().refresh([{ ...target, fingerprint: "f1" }]);

    let releaseF2: (value: string) => void = () => {};
    invoke.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          releaseF2 = resolve;
        }),
    );
    const flight = useTitlesStore.getState().refresh([{ ...target, fingerprint: "f2" }]);
    await useTitlesStore.getState().refresh([{ ...target, fingerprint: "f1" }]);
    releaseF2("Poison");
    await flight;

    const state = useTitlesStore.getState();
    expect(state.titles[titleKey(target)]).toBe("Claude title");
    expect(state.fetchedFingerprints[titleKey(target)]).toBe("f1");
    expect(state.inFlight[titleKey(target)]).toBeUndefined();
  });

  it("drops a fetch that resolves after its session was pruned", async () => {
    let release: (value: string) => void = () => {};
    const slow = new Promise<string>((resolve) => {
      release = resolve;
    });
    invoke.mockImplementationOnce(() => slow);

    const target = { cwd: "/p", agent: "claude" as const, sessionId: "gone" };
    const inFlight = useTitlesStore.getState().refresh([{ ...target, fingerprint: "0|0" }]);
    useTitlesStore.getState().prune(new Set());
    release("Zombie");
    await inFlight;

    const state = useTitlesStore.getState();
    expect(state.titles[titleKey(target)]).toBeUndefined();
    expect(state.fetchedFingerprints[titleKey(target)]).toBeUndefined();
  });

  it("a pruned-then-relaunched key only accepts the relaunched fetch", async () => {
    // ABA: the key is pruned while a fetch is in flight, then becomes live
    // again and refetches. The relaunch has a fresh generation, so the stale
    // first fetch must not land even though the key is live again.
    let releaseZombie: (value: string) => void = () => {};
    const zombie = new Promise<string>((resolve) => {
      releaseZombie = resolve;
    });
    invoke
      .mockImplementationOnce(() => zombie)
      .mockImplementationOnce(async () => "Fresh");

    const target = { cwd: "/p", agent: "claude" as const, sessionId: "aba" };
    const first = useTitlesStore.getState().refresh([{ ...target, fingerprint: "0|0" }]);
    useTitlesStore.getState().prune(new Set());
    await useTitlesStore.getState().refresh([{ ...target, fingerprint: "0|0" }]);
    expect(useTitlesStore.getState().titles[titleKey(target)]).toBe("Fresh");

    releaseZombie("Zombie");
    await first;
    expect(useTitlesStore.getState().titles[titleKey(target)]).toBe("Fresh");
  });

  it("records the fingerprint of a titleless fetch so siblings do not retrigger it", async () => {
    invoke.mockImplementation(async () => null);
    const target = { cwd: "/p", agent: "claude" as const, sessionId: "fresh" };

    await useTitlesStore.getState().refresh([{ ...target, fingerprint: "0|3" }]);
    invoke.mockClear();
    await useTitlesStore.getState().refresh([{ ...target, fingerprint: "0|3" }]);

    expect(invoke).not.toHaveBeenCalled();
    const state = useTitlesStore.getState();
    expect(state.titles[titleKey(target)]).toBeUndefined();
    expect(state.fetchedFingerprints[titleKey(target)]).toBe("0|3");
  });

  it("keeps the titles reference stable when a batch lands no text change", async () => {
    // Every open card subscribes to `titles`; a bookkeeping-only landing
    // (titleless fetch) must not re-render them all.
    invoke.mockImplementation(async () => null);
    const before = useTitlesStore.getState().titles;

    await useTitlesStore
      .getState()
      .refresh([{ cwd: "/p", agent: "claude", sessionId: "s", fingerprint: "0|1" }]);

    expect(useTitlesStore.getState().titles).toBe(before);
  });

  it("keeps an existing title when a later fetch finds none", async () => {
    const target = { cwd: "/p", agent: "claude" as const, sessionId: "s" };
    await useTitlesStore.getState().refresh([{ ...target, fingerprint: "a" }]);
    expect(useTitlesStore.getState().titles[titleKey(target)]).toBe("Claude title");

    invoke.mockImplementation(async () => null);
    await useTitlesStore.getState().refresh([{ ...target, fingerprint: "b" }]);

    expect(useTitlesStore.getState().titles[titleKey(target)]).toBe("Claude title");
    expect(useTitlesStore.getState().fetchedFingerprints[titleKey(target)]).toBe("b");
  });

  it("collapses a batch into one titles update", async () => {
    let titlesChanges = 0;
    let previous = useTitlesStore.getState().titles;
    const unsub = useTitlesStore.subscribe((state) => {
      if (state.titles !== previous) {
        titlesChanges += 1;
        previous = state.titles;
      }
    });
    await useTitlesStore.getState().refresh([
      { cwd: "/a", agent: "claude", fingerprint: "0|0" },
      { cwd: "/b", agent: "claude", fingerprint: "0|0" },
      { cwd: "/c", agent: "codex", fingerprint: "0|0" },
    ]);
    unsub();
    // Three fetches must land as one titles change, not three.
    expect(titlesChanges).toBe(1);
    const { titles } = useTitlesStore.getState();
    expect(titles[progressKey("/a", "claude")]).toBe("Claude title");
    expect(titles[progressKey("/b", "claude")]).toBe("Claude title");
    expect(titles[progressKey("/c", "codex")]).toBe("Codex title");
  });

  it("still caches successful titles when another fetch in the batch fails", async () => {
    invoke.mockImplementation(
      async (command: string, args: { cwd?: string } | undefined) => {
        if (command === "claude_session_title" && args?.cwd === "/bad") {
          throw new Error("no transcript");
        }
        return command === "codex_session_title" ? "Codex title" : "Claude title";
      },
    );
    await useTitlesStore.getState().refresh([
      { cwd: "/good", agent: "claude", fingerprint: "0|0" },
      { cwd: "/bad", agent: "claude", fingerprint: "0|0" },
    ]);
    const { titles } = useTitlesStore.getState();
    expect(titles[progressKey("/good", "claude")]).toBe("Claude title");
    expect(titles[progressKey("/bad", "claude")]).toBeUndefined();
  });

  it("prunes cached entries whose session is no longer visible", async () => {
    const live = { cwd: "/p", agent: "claude" as const, sessionId: "live" };
    const dead = { cwd: "/p", agent: "claude" as const, sessionId: "dead" };
    await useTitlesStore.getState().refresh([
      { ...live, fingerprint: "0|0" },
      { ...dead, fingerprint: "0|0" },
    ]);

    useTitlesStore.getState().prune(new Set([titleKey(live)]));

    const state = useTitlesStore.getState();
    expect(state.titles[titleKey(live)]).toBe("Claude title");
    expect(state.titles[titleKey(dead)]).toBeUndefined();
    expect(state.fetchedFingerprints[titleKey(dead)]).toBeUndefined();
  });

  it("pruning with nothing dead keeps the state reference", async () => {
    const live = { cwd: "/p", agent: "claude" as const, sessionId: "live" };
    await useTitlesStore.getState().refresh([{ ...live, fingerprint: "0|0" }]);
    const before = useTitlesStore.getState();

    useTitlesStore.getState().prune(new Set([titleKey(live)]));

    expect(useTitlesStore.getState()).toBe(before);
  });

  it("pruning bookkeeping-only entries keeps the titles reference", async () => {
    invoke.mockImplementation(async () => null);
    const dead = { cwd: "/p", agent: "claude" as const, sessionId: "dead" };
    await useTitlesStore.getState().refresh([{ ...dead, fingerprint: "0|0" }]);
    const before = useTitlesStore.getState().titles;

    useTitlesStore.getState().prune(new Set());

    expect(useTitlesStore.getState().titles).toBe(before);
    expect(useTitlesStore.getState().fetchedFingerprints[titleKey(dead)]).toBeUndefined();
  });
});
