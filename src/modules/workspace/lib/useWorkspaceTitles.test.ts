import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { progressKey, useProgressStore } from "@/modules/claude-progress/lib/progressStore";
import { useSessionStatusStore } from "@/modules/claude-progress/lib/sessionStatusStore";
import { useTitlesStore } from "./titlesStore";
import { useWorkspaceTitles, type VisibleSession } from "./useWorkspaceTitles";

const refresh = vi.fn(async () => {});

beforeEach(() => {
  refresh.mockClear();
  useProgressStore.setState({ sessions: {}, sessionEpochs: {} });
  useSessionStatusStore.setState({
    statuses: {},
    agents: {},
    sessionIds: {},
    statusEpochs: {},
  });
  useTitlesStore.setState({ titles: {}, fetchedFingerprints: {}, inFlight: {}, refresh });
});

describe("useWorkspaceTitles", () => {
  it("stamps a new fingerprint when a leaf's status epoch changes", async () => {
    const target: VisibleSession = {
      cwd: "/p",
      agent: "claude",
      sessionId: "session-a",
      leafId: "leaf-1",
    };
    useProgressStore.setState({
      sessionEpochs: { [progressKey("/p", "claude")]: 2 },
    });
    renderHook(() => useWorkspaceTitles([target]));

    await waitFor(() =>
      expect(refresh).toHaveBeenLastCalledWith([
        { cwd: "/p", agent: "claude", sessionId: "session-a", fingerprint: "2|leaf-1:0" },
      ]),
    );

    act(() => useSessionStatusStore.getState().setStatus("leaf-1", "idle"));

    await waitFor(() => {
      expect(refresh).toHaveBeenCalledTimes(2);
      expect(refresh).toHaveBeenLastCalledWith([
        { cwd: "/p", agent: "claude", sessionId: "session-a", fingerprint: "2|leaf-1:1" },
      ]);
    });
  });

  it("stamps every contributing pane's epoch when panes share one legacy key", async () => {
    // Two codex panes in one cwd share the legacy key but carry their own
    // status epochs. The fingerprint carries the whole multiset, so a bump in
    // either pane — or one pane leaving — changes the stamp and refetches
    // exactly once; no ordering between the panes is ever assumed.
    useSessionStatusStore.setState({
      statusEpochs: { "leaf-a": 1, "leaf-b": 4 },
    });
    const shared = { cwd: "/p", agent: "codex" as const };
    const { rerender } = renderHook(
      ({ sessions }: { sessions: VisibleSession[] }) => useWorkspaceTitles(sessions),
      {
        initialProps: {
          sessions: [
            { ...shared, leafId: "leaf-a" },
            { ...shared, leafId: "leaf-b" },
          ] as VisibleSession[],
        },
      },
    );

    await waitFor(() =>
      expect(refresh).toHaveBeenLastCalledWith([
        { cwd: "/p", agent: "codex", sessionId: undefined, fingerprint: "0|leaf-a:1,leaf-b:4" },
      ]),
    );

    // The higher-epoch pane closes: the stamp shrinks, which is still a
    // change — one refetch, not a suppression window.
    rerender({ sessions: [{ ...shared, leafId: "leaf-a" }] });
    await waitFor(() => {
      expect(refresh).toHaveBeenCalledTimes(2);
      expect(refresh).toHaveBeenLastCalledWith([
        { cwd: "/p", agent: "codex", sessionId: undefined, fingerprint: "0|leaf-a:1" },
      ]);
    });
  });

  it("deduplicates visible sessions that share one title key", async () => {
    const target: VisibleSession = {
      cwd: "/p",
      agent: "claude",
      sessionId: "session-a",
      leafId: "leaf-1",
    };
    renderHook(() => useWorkspaceTitles([target, { ...target }]));

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(refresh).toHaveBeenCalledWith([
      { cwd: "/p", agent: "claude", sessionId: "session-a", fingerprint: "0|leaf-1:0" },
    ]);
  });

  it("prunes keys that leave the visible set", async () => {
    const prune = vi.fn();
    useTitlesStore.setState({ prune });
    const target: VisibleSession = {
      cwd: "/p",
      agent: "claude",
      sessionId: "session-a",
      leafId: "leaf-1",
    };
    const { rerender } = renderHook(
      ({ sessions }: { sessions: VisibleSession[] }) => useWorkspaceTitles(sessions),
      { initialProps: { sessions: [target] as VisibleSession[] } },
    );

    await waitFor(() =>
      expect(prune).toHaveBeenLastCalledWith(new Set(["claude:/p:session-a"])),
    );

    rerender({ sessions: [] });
    await waitFor(() => expect(prune).toHaveBeenLastCalledWith(new Set()));
  });
});
