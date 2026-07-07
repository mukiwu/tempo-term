import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionsTabContent } from "./SessionsTabContent";
import { useSessionsStore } from "./lib/sessionsStore";
import { useTabsStore } from "@/stores/tabsStore";
import type { SessionSummary, TranscriptMessage } from "./lib/sessionsBridge";
import type { SessionsStats } from "./lib/statsBridge";
import type { CommitInfo } from "@/modules/source-control/lib/gitBridge";

// vi.mock is hoisted to the top of the file, so mocks must be created with
// vi.hoisted() to be accessible inside the factory callbacks.
const {
  mockInvoke,
  mockListen,
  mockUnlisten,
  mockSave,
  mockFsWriteFile,
  transcripts,
  statsFixture,
  deleteFailure,
  exportFailure,
  exportMarkdown,
  commitsFixture,
} = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  mockListen: vi.fn(),
  mockUnlisten: vi.fn(),
  // Backs the save dialog the export button opens.
  mockSave: vi.fn(),
  mockFsWriteFile: vi.fn(),
  // Backs "sessions_get" invoke responses per session id. Each entry is a
  // resolver the test controls directly, so responses can be made to land in
  // any order (needed for the stale-response race test below).
  transcripts: new Map<string, Promise<TranscriptMessage[]>>(),
  // Backs the "sessions_stats" invoke response the dashboard fetches whenever
  // nothing is selected.
  statsFixture: { current: null as unknown },
  // When set, "sessions_delete" rejects — for the failure-surfacing tests.
  deleteFailure: { current: false },
  // When set, "sessions_export" rejects — for the failure-surfacing tests.
  exportFailure: { current: false },
  exportMarkdown: { current: "# Fix flaky test\n\nsome content\n" },
  // Backs the "git_commits_in_range" invoke response for the commits section.
  commitsFixture: { current: [] as CommitInfo[] },
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: { id?: string; cwd?: string; sinceMs?: number; untilMs?: number }) => {
    mockInvoke(cmd, args);
    if (cmd === "sessions_get" && args?.id) {
      return transcripts.get(args.id) ?? Promise.resolve([]);
    }
    if (cmd === "sessions_stats") {
      return Promise.resolve(statsFixture.current);
    }
    if (cmd === "sessions_delete" && deleteFailure.current) {
      return Promise.reject(new Error("trash failed"));
    }
    if (cmd === "sessions_export") {
      return exportFailure.current
        ? Promise.reject(new Error("export failed"))
        : Promise.resolve(exportMarkdown.current);
    }
    if (cmd === "git_commits_in_range") {
      return Promise.resolve(commitsFixture.current);
    }
    return Promise.resolve(undefined);
  },
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: mockListen,
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  save: mockSave,
}));

vi.mock("@/modules/explorer/lib/fsBridge", () => ({
  fsWriteFile: mockFsWriteFile,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts?.count !== undefined ? `${key}:${opts.count}` : key,
  }),
}));

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

function message(overrides: Partial<TranscriptMessage>): TranscriptMessage {
  return {
    role: "user",
    text: "hello",
    timestamp: null,
    tool_name: null,
    ...overrides,
  };
}

function stats(overrides: Partial<SessionsStats> = {}): SessionsStats {
  return {
    cards: {
      sessions: 0,
      messages: 0,
      user_messages: 0,
      projects: 0,
      active_days: 0,
      messages_per_session: 0,
      output_tokens: 0,
    },
    heatmap: [],
    top_by_messages: [],
    top_by_tokens: [],
    weekly: [],
    range_models: [],
    hourly: new Array(24).fill(0),
    ...overrides,
  };
}

describe("SessionsTabContent", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockListen.mockReset().mockResolvedValue(mockUnlisten);
    mockUnlisten.mockReset();
    mockSave.mockReset();
    mockFsWriteFile.mockReset().mockResolvedValue(undefined);
    transcripts.clear();
    statsFixture.current = stats();
    deleteFailure.current = false;
    exportFailure.current = false;
    exportMarkdown.current = "# Fix flaky test\n\nsome content\n";
    commitsFixture.current = [];
    useSessionsStore.setState({
      sessions: [],
      loaded: false,
      query: "",
      agentFilter: "all",
      selectedId: null,
    });
    useTabsStore.setState({ spaces: [], activeSpaceId: null, tabs: [], activeId: null });
  });

  it("renders the dashboard instead of a viewer when nothing is selected", async () => {
    statsFixture.current = stats({
      top_by_messages: [
        { id: "a", agent: "claude", title: "Fix flaky test", project_cwd: "/repo/app", value: 42 },
      ],
    });

    render(<SessionsTabContent />);

    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith("sessions_stats", { days: 365 }));
    expect(screen.getByText("sessions.dashboard.title")).toBeInTheDocument();
  });

  it("selects a session and shows the viewer when a dashboard top-session row is clicked, then returns via the back button", async () => {
    const target = session({ id: "a", title: "Fix flaky test", agent: "claude" });
    useSessionsStore.setState({ sessions: [target], selectedId: null });
    statsFixture.current = stats({
      top_by_messages: [
        { id: "a", agent: "claude", title: "Fix flaky test", project_cwd: "/Users/muki/project", value: 42 },
      ],
    });
    transcripts.set("a", Promise.resolve([]));

    render(<SessionsTabContent />);
    await waitFor(() => expect(screen.getByText("Fix flaky test")).toBeInTheDocument());

    fireEvent.click(screen.getByText("Fix flaky test"));

    // The viewer takes over: its header (with the resume button) appears.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "sessions.resume" })).toBeInTheDocument(),
    );
    expect(useSessionsStore.getState().selectedId).toBe("a");

    fireEvent.click(screen.getByRole("button", { name: "sessions.dashboard.back" }));

    expect(useSessionsStore.getState().selectedId).toBe(null);
    await waitFor(() => expect(screen.getByText("sessions.dashboard.title")).toBeInTheDocument());
  });

  it("fetches and renders the transcript for the selected session", async () => {
    const target = session({ id: "a", title: "Fix flaky test", agent: "codex" });
    useSessionsStore.setState({ sessions: [target], selectedId: "a" });
    transcripts.set(
      "a",
      Promise.resolve([
        message({ role: "user", text: "Why is this test flaky?" }),
        message({ role: "assistant", text: "Let me investigate." }),
        message({ role: "tool", text: "grep output here", tool_name: "grep" }),
        message({ role: "system", text: "Session resumed." }),
      ]),
    );

    render(<SessionsTabContent />);

    expect(mockInvoke).toHaveBeenCalledWith("sessions_get", { id: "a" });
    await waitFor(() => expect(screen.getByText("Why is this test flaky?")).toBeInTheDocument());

    expect(screen.getByText("Fix flaky test")).toBeInTheDocument();
    expect(screen.getByText("sessions.agents.codex")).toBeInTheDocument();
    expect(screen.getByText("/Users/muki/project")).toBeInTheDocument();
    expect(screen.getByText("Let me investigate.")).toBeInTheDocument();
    expect(screen.getByText("grep")).toBeInTheDocument();
    expect(screen.getByText("Session resumed.")).toBeInTheDocument();
  });

  it("renders assistant messages as markdown but keeps user messages plain", async () => {
    useSessionsStore.setState({ sessions: [session({ id: "a" })], selectedId: "a" });
    transcripts.set(
      "a",
      Promise.resolve([
        message({ role: "user", text: "please make **this** bold" }),
        message({ role: "assistant", text: "Some **bold** and `code` here." }),
      ]),
    );

    render(<SessionsTabContent />);

    await waitFor(() => expect(screen.getByText("bold")).toBeInTheDocument());
    // Assistant markdown is rendered: **bold** becomes a <strong> element.
    expect(screen.getByText("bold").tagName).toBe("STRONG");
    expect(screen.getByText("code").tagName).toBe("CODE");
    // The user's own text is never interpreted as markdown.
    expect(screen.getByText("please make **this** bold")).toBeInTheDocument();
  });

  it("collapses injected harness turns behind a labelled card", async () => {
    useSessionsStore.setState({ sessions: [session({ id: "a" })], selectedId: "a" });
    transcripts.set(
      "a",
      Promise.resolve([
        message({ role: "user", text: "real question" }),
        message({
          role: "injected",
          text: "Another Claude session sent a message:\n## report with **bold**",
          tool_name: "teammate",
        }),
      ]),
    );

    render(<SessionsTabContent />);

    await waitFor(() => expect(screen.getByText("real question")).toBeInTheDocument());
    // Collapsed by default: the source label is visible, the body is inside
    // a <details> and renders as markdown when expanded.
    const summary = screen.getByText("sessions.injected.teammate");
    expect(summary.closest("details")).not.toBeNull();
    // The body renders as markdown: "## report…" becomes a heading.
    expect(screen.getByRole("heading", { level: 2, name: /report with/ })).toBeInTheDocument();
  });

  it("shows a loading indicator while the transcript is in flight", async () => {
    useSessionsStore.setState({ sessions: [session({ id: "a" })], selectedId: "a" });
    let resolve!: (messages: TranscriptMessage[]) => void;
    transcripts.set(
      "a",
      new Promise((r) => {
        resolve = r;
      }),
    );

    render(<SessionsTabContent />);

    expect(screen.getByText("sessions.loading")).toBeInTheDocument();

    resolve([message({ text: "done loading" })]);
    await waitFor(() => expect(screen.getByText("done loading")).toBeInTheDocument());
    expect(screen.queryByText("sessions.loading")).not.toBeInTheDocument();
  });

  it("keeps the previous transcript on screen and shows a muted error line when a new selection fails to load", async () => {
    const sessionA = session({ id: "a" });
    const sessionB = session({ id: "b" });
    useSessionsStore.setState({ sessions: [sessionA, sessionB], selectedId: "a" });
    transcripts.set("a", Promise.resolve([message({ text: "first load" })]));
    const { rerender } = render(<SessionsTabContent />);
    await waitFor(() => expect(screen.getByText("first load")).toBeInTheDocument());

    // Switching to session b, whose fetch fails.
    transcripts.set("b", Promise.reject(new Error("disk read failed")));
    act(() => {
      useSessionsStore.setState({ selectedId: "b" });
    });
    rerender(<SessionsTabContent />);

    await waitFor(() =>
      expect(screen.getByText("sessions.loadError: disk read failed")).toBeInTheDocument(),
    );
    // The transcript already on screen is untouched by the failed fetch.
    expect(screen.getByText("first load")).toBeInTheDocument();
  });

  it("ignores a stale transcript response for a session the user has already navigated away from", async () => {
    const sessionA = session({ id: "a" });
    const sessionB = session({ id: "b" });
    useSessionsStore.setState({ sessions: [sessionA, sessionB], selectedId: "a" });

    let resolveA!: (messages: TranscriptMessage[]) => void;
    transcripts.set(
      "a",
      new Promise((r) => {
        resolveA = r;
      }),
    );
    transcripts.set("b", Promise.resolve([message({ text: "session b message" })]));

    const { rerender } = render(<SessionsTabContent />);

    // Navigate to session b before a's fetch resolves.
    act(() => {
      useSessionsStore.setState({ selectedId: "b" });
    });
    rerender(<SessionsTabContent />);
    await waitFor(() => expect(screen.getByText("session b message")).toBeInTheDocument());

    // a's stale response now lands — it must not clobber b's transcript.
    await act(async () => {
      resolveA([message({ text: "session a message" })]);
      await Promise.resolve();
    });

    expect(screen.getByText("session b message")).toBeInTheDocument();
    expect(screen.queryByText("session a message")).not.toBeInTheDocument();
  });

  it("resumes a claude session via the header button, opening a new terminal tab at its project cwd", async () => {
    const target = session({ id: "a", agent: "claude", project_cwd: "/repo/app" });
    useSessionsStore.setState({ sessions: [target], selectedId: "a" });
    transcripts.set("a", Promise.resolve([]));

    render(<SessionsTabContent />);
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith("sessions_get", { id: "a" }));

    const button = screen.getByRole("button", { name: "sessions.resume" });
    expect(button).not.toBeDisabled();
    fireEvent.click(button);

    const tabs = useTabsStore.getState().tabs;
    expect(tabs).toHaveLength(1);
    expect(tabs[0].kind).toBe("terminal");
    expect(tabs[0].cwd).toBe("/repo/app");
  });

  it("opens a confirm dialog from the header delete button instead of deleting immediately", async () => {
    const target = session({ id: "a" });
    useSessionsStore.setState({ sessions: [target], selectedId: "a" });
    transcripts.set("a", Promise.resolve([]));

    render(<SessionsTabContent />);
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith("sessions_get", { id: "a" }));

    fireEvent.click(screen.getByRole("button", { name: "sessions.delete" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("sessions.deleteConfirm")).toBeInTheDocument();
    expect(mockInvoke).not.toHaveBeenCalledWith("sessions_delete", expect.anything());
  });

  it("cancels the header delete confirmation without invoking sessions_delete", async () => {
    const target = session({ id: "a" });
    useSessionsStore.setState({ sessions: [target], selectedId: "a" });
    transcripts.set("a", Promise.resolve([]));

    render(<SessionsTabContent />);
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith("sessions_get", { id: "a" }));

    fireEvent.click(screen.getByRole("button", { name: "sessions.delete" }));
    fireEvent.click(screen.getByRole("button", { name: "actions.cancel" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mockInvoke).not.toHaveBeenCalledWith("sessions_delete", expect.anything());
  });

  it("deletes the current session via the header delete button on confirm, returning to the dashboard", async () => {
    const target = session({ id: "a", agent: "claude", project_cwd: "/repo/app" });
    useSessionsStore.setState({ sessions: [target], selectedId: "a" });
    transcripts.set("a", Promise.resolve([]));

    render(<SessionsTabContent />);
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith("sessions_get", { id: "a" }));

    fireEvent.click(screen.getByRole("button", { name: "sessions.delete" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "sessions.delete" }));

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("sessions_delete", { id: "a" }),
    );
    expect(useSessionsStore.getState().selectedId).toBe(null);
    await waitFor(() => expect(screen.getByText("sessions.dashboard.title")).toBeInTheDocument());
  });

  it("shows an error line and stays on the viewer when the header delete fails", async () => {
    const target = session({ id: "a", title: "Fix flaky test" });
    useSessionsStore.setState({ sessions: [target], selectedId: "a" });
    transcripts.set("a", Promise.resolve([]));
    deleteFailure.current = true;

    render(<SessionsTabContent />);
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith("sessions_get", { id: "a" }));

    fireEvent.click(screen.getByRole("button", { name: "sessions.delete" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "sessions.delete" }));

    // The failure is surfaced in the viewer, and the session stays selected
    // (no bounce back to the dashboard).
    await waitFor(() => expect(screen.getByText("sessions.deleteError")).toBeInTheDocument());
    expect(useSessionsStore.getState().selectedId).toBe("a");
    expect(screen.getByText("Fix flaky test")).toBeInTheDocument();
  });

  it("exports the current session via the header export button, writing the rendered markdown to the chosen path", async () => {
    const target = session({ id: "a", title: "Fix flaky test" });
    useSessionsStore.setState({ sessions: [target], selectedId: "a" });
    transcripts.set("a", Promise.resolve([]));
    exportMarkdown.current = "# Fix flaky test\n\nsome content\n";
    mockSave.mockResolvedValue("/Users/muki/Desktop/fix-flaky-test.md");

    render(<SessionsTabContent />);
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith("sessions_get", { id: "a" }));

    fireEvent.click(screen.getByRole("button", { name: "sessions.export" }));

    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith("sessions_export", { id: "a" }));
    await waitFor(() =>
      expect(mockFsWriteFile).toHaveBeenCalledWith(
        "/Users/muki/Desktop/fix-flaky-test.md",
        "# Fix flaky test\n\nsome content\n",
      ),
    );
    expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: "fix-flaky-test.md" }),
    );
  });

  it("does nothing when the export save dialog is cancelled", async () => {
    const target = session({ id: "a", title: "Fix flaky test" });
    useSessionsStore.setState({ sessions: [target], selectedId: "a" });
    transcripts.set("a", Promise.resolve([]));
    mockSave.mockResolvedValue(null);

    render(<SessionsTabContent />);
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith("sessions_get", { id: "a" }));

    fireEvent.click(screen.getByRole("button", { name: "sessions.export" }));

    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith("sessions_export", { id: "a" }));
    expect(mockFsWriteFile).not.toHaveBeenCalled();
  });

  it("shows an error line when exporting the transcript fails", async () => {
    const target = session({ id: "a", title: "Fix flaky test" });
    useSessionsStore.setState({ sessions: [target], selectedId: "a" });
    transcripts.set("a", Promise.resolve([]));
    exportFailure.current = true;

    render(<SessionsTabContent />);
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith("sessions_get", { id: "a" }));

    fireEvent.click(screen.getByRole("button", { name: "sessions.export" }));

    await waitFor(() => expect(screen.getByText("sessions.exportError")).toBeInTheDocument());
    expect(mockSave).not.toHaveBeenCalled();
    expect(mockFsWriteFile).not.toHaveBeenCalled();
  });

  it("shows an error line when writing the exported file fails", async () => {
    const target = session({ id: "a", title: "Fix flaky test" });
    useSessionsStore.setState({ sessions: [target], selectedId: "a" });
    transcripts.set("a", Promise.resolve([]));
    mockSave.mockResolvedValue("/Users/muki/Desktop/fix-flaky-test.md");
    mockFsWriteFile.mockRejectedValue(new Error("disk full"));

    render(<SessionsTabContent />);
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith("sessions_get", { id: "a" }));

    fireEvent.click(screen.getByRole("button", { name: "sessions.export" }));

    await waitFor(() => expect(screen.getByText("sessions.exportError")).toBeInTheDocument());
  });

  it("disables the header resume button for antigravity sessions instead of hiding it", async () => {
    const target = session({ id: "a", agent: "antigravity" });
    useSessionsStore.setState({ sessions: [target], selectedId: "a" });
    transcripts.set("a", Promise.resolve([]));

    render(<SessionsTabContent />);
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith("sessions_get", { id: "a" }));

    expect(screen.getByRole("button", { name: "sessions.resume" })).toBeDisabled();
  });

  it("shows a commits section listing commits made during the session", async () => {
    const target = session({ id: "a", project_cwd: "/repo/app", started_at: 1000, ended_at: 2000 });
    useSessionsStore.setState({ sessions: [target], selectedId: "a" });
    transcripts.set("a", Promise.resolve([]));
    commitsFixture.current = [
      { id: "abc1234", summary: "Fix flaky test", author: "Tester", timestamp: 1500, parents: [] },
    ];

    render(<SessionsTabContent />);

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("git_commits_in_range", {
        cwd: "/repo/app",
        sinceMs: 1000,
        untilMs: 2000,
      }),
    );
    await waitFor(() => expect(screen.getByText("sessions.commits.title")).toBeInTheDocument());
    expect(screen.getByText("Fix flaky test")).toBeInTheDocument();
  });

  it("hides the commits section entirely when there are no commits", async () => {
    const target = session({ id: "a" });
    useSessionsStore.setState({ sessions: [target], selectedId: "a" });
    transcripts.set("a", Promise.resolve([]));
    commitsFixture.current = [];

    render(<SessionsTabContent />);

    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith("sessions_get", { id: "a" }));
    expect(screen.queryByText("sessions.commits.title")).not.toBeInTheDocument();
  });
});
