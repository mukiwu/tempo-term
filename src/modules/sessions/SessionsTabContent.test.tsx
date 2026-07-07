import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionsTabContent } from "./SessionsTabContent";
import { useSessionsStore } from "./lib/sessionsStore";
import { useTabsStore } from "@/stores/tabsStore";
import type { SessionSummary, TranscriptMessage } from "./lib/sessionsBridge";

// vi.mock is hoisted to the top of the file, so mocks must be created with
// vi.hoisted() to be accessible inside the factory callbacks.
const { mockInvoke, transcripts } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  // Backs "sessions_get" invoke responses per session id. Each entry is a
  // resolver the test controls directly, so responses can be made to land in
  // any order (needed for the stale-response race test below).
  transcripts: new Map<string, Promise<TranscriptMessage[]>>(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: { id?: string }) => {
    mockInvoke(cmd, args);
    if (cmd === "sessions_get" && args?.id) {
      return transcripts.get(args.id) ?? Promise.resolve([]);
    }
    return Promise.resolve(undefined);
  },
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

describe("SessionsTabContent", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    transcripts.clear();
    useSessionsStore.setState({
      sessions: [],
      loaded: false,
      query: "",
      agentFilter: "all",
      selectedId: null,
    });
    useTabsStore.setState({ spaces: [], activeSpaceId: null, tabs: [], activeId: null });
  });

  it("shows the select prompt and total session count when nothing is selected", () => {
    useSessionsStore.setState({
      sessions: [session({ id: "a" }), session({ id: "b" })],
      selectedId: null,
    });

    render(<SessionsTabContent />);

    expect(screen.getByText("sessions.selectPrompt")).toBeInTheDocument();
    expect(screen.getByText("sessions.totalCount:2")).toBeInTheDocument();
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

  it("disables the header resume button for antigravity sessions instead of hiding it", async () => {
    const target = session({ id: "a", agent: "antigravity" });
    useSessionsStore.setState({ sessions: [target], selectedId: "a" });
    transcripts.set("a", Promise.resolve([]));

    render(<SessionsTabContent />);
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith("sessions_get", { id: "a" }));

    expect(screen.getByRole("button", { name: "sessions.resume" })).toBeDisabled();
  });
});
