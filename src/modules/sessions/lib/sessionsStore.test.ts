import { describe, expect, it } from "vitest";
import { useSessionsStore, visibleSessions } from "./sessionsStore";
import type { SessionSummary } from "./sessionsBridge";

function session(overrides: Partial<SessionSummary>): SessionSummary {
  return {
    id: "id",
    agent: "claude",
    project_cwd: "/Users/muki/project",
    title: "Untitled",
    started_at: 0,
    ended_at: 0,
    message_count: 0,
    user_message_count: 0,
    output_tokens: null,
    model: null,
    file_path: "/tmp/session.jsonl",
    pinned: false,
    ...overrides,
  };
}

describe("visibleSessions", () => {
  it("splits pinned from history", () => {
    const a = session({ id: "a", pinned: true, ended_at: 1 });
    const b = session({ id: "b", pinned: false, ended_at: 2 });

    const { pinned, history } = visibleSessions([a, b], "", "all", "all");

    expect(pinned).toEqual([a]);
    expect(history).toEqual([b]);
  });

  it("sorts pinned sessions by ended_at descending", () => {
    const older = session({ id: "older", pinned: true, ended_at: 100 });
    const newer = session({ id: "newer", pinned: true, ended_at: 200 });

    const { pinned } = visibleSessions([older, newer], "", "all", "all");

    expect(pinned.map((s) => s.id)).toEqual(["newer", "older"]);
  });

  it("history excludes every pinned session regardless of order", () => {
    const pinnedSession = session({ id: "p", pinned: true, ended_at: 50 });
    const historySession = session({ id: "h", pinned: false, ended_at: 10 });

    const { history } = visibleSessions([pinnedSession, historySession], "", "all", "all");

    expect(history).toEqual([historySession]);
  });

  it("filters by agent", () => {
    const claude = session({ id: "c", agent: "claude" });
    const codex = session({ id: "x", agent: "codex" });

    const { history } = visibleSessions([claude, codex], "", "codex", "all");

    expect(history).toEqual([codex]);
  });

  it("keeps everything when agentFilter is 'all'", () => {
    const claude = session({ id: "c", agent: "claude" });
    const codex = session({ id: "x", agent: "codex" });

    const { history } = visibleSessions([claude, codex], "", "all", "all");

    expect(history.map((s) => s.id)).toEqual(["c", "x"]);
  });

  it("matches query against title, case-insensitively", () => {
    const match = session({ id: "m", title: "Refactor Auth Flow" });
    const noMatch = session({ id: "n", title: "Unrelated" });

    const { history } = visibleSessions([match, noMatch], "refactor", "all", "all");

    expect(history).toEqual([match]);
  });

  it("matches query against project_cwd, case-insensitively", () => {
    const match = session({ id: "m", title: "x", project_cwd: "/Users/muki/Tempo-Term" });
    const noMatch = session({ id: "n", title: "y", project_cwd: "/Users/muki/other" });

    const { history } = visibleSessions([match, noMatch], "tempo-term", "all", "all");

    expect(history).toEqual([match]);
  });

  it("combines query and agent filter", () => {
    const claudeMatch = session({ id: "cm", agent: "claude", title: "deploy script" });
    const codexMatch = session({ id: "xm", agent: "codex", title: "deploy script" });
    const claudeNoMatch = session({ id: "cn", agent: "claude", title: "unrelated" });

    const { history } = visibleSessions(
      [claudeMatch, codexMatch, claudeNoMatch],
      "deploy",
      "claude",
      "all",
    );

    expect(history).toEqual([claudeMatch]);
  });

  it("returns empty arrays when nothing matches", () => {
    const s = session({ id: "s", title: "foo" });

    const { pinned, history } = visibleSessions([s], "nomatch", "all", "all");

    expect(pinned).toEqual([]);
    expect(history).toEqual([]);
  });

  it("applies the query filter to pinned sessions too", () => {
    const pinnedMatch = session({ id: "pm", pinned: true, title: "release notes" });
    const pinnedNoMatch = session({ id: "pn", pinned: true, title: "unrelated" });

    const { pinned } = visibleSessions([pinnedMatch, pinnedNoMatch], "release", "all", "all");

    expect(pinned).toEqual([pinnedMatch]);
  });

  it("visibleSessions filters by exact model, with 'all' passing everything", () => {
    const mk = (id: string, model: string | null) =>
      ({ id, agent: "claude", project_cwd: "/p", title: id, started_at: 0, ended_at: 0,
         message_count: 0, user_message_count: 0, output_tokens: null, model, file_path: "/f",
         pinned: false }) as SessionSummary;
    const sessions = [mk("a", "claude-opus-4-8"), mk("b", "gpt-5.5"), mk("c", null)];

    expect(visibleSessions(sessions, "", "all", "all").history.map((s) => s.id)).toEqual(["a", "b", "c"]);
    expect(visibleSessions(sessions, "", "all", "gpt-5.5").history.map((s) => s.id)).toEqual(["b"]);
    // null-model sessions never match a specific model.
    expect(visibleSessions(sessions, "", "all", "claude-opus-4-8").history.map((s) => s.id)).toEqual(["a"]);
  });
});

describe("useSessionsStore", () => {
  it("selectProject sets the project and clears any selected session", () => {
    useSessionsStore.setState({ selectedId: "s1", selectedProject: null });
    useSessionsStore.getState().selectProject("/tmp/proj-a");
    expect(useSessionsStore.getState().selectedProject).toBe("/tmp/proj-a");
    expect(useSessionsStore.getState().selectedId).toBeNull();
  });

  it("select clears any selected project", () => {
    useSessionsStore.setState({ selectedProject: "/tmp/proj-a", selectedId: null });
    useSessionsStore.getState().select("s2");
    expect(useSessionsStore.getState().selectedId).toBe("s2");
    expect(useSessionsStore.getState().selectedProject).toBeNull();
  });
});
