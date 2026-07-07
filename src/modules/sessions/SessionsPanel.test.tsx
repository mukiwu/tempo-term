import { act, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionsPanel } from "./SessionsPanel";
import { useSessionsStore } from "./lib/sessionsStore";
import type { SessionSummary } from "./lib/sessionsBridge";
import { useTabsStore, type Tab } from "@/stores/tabsStore";
import { useSessionStatusStore } from "@/modules/claude-progress/lib/sessionStatusStore";
import { leaf } from "@/modules/terminal/lib/terminalLayout";

// vi.mock is hoisted to the top of the file, so mocks must be created with
// vi.hoisted() to be accessible inside the factory callbacks.
const { mockInvoke, mockListen, mockUnlisten, sessionsFixture, deleteFailure } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  mockListen: vi.fn(),
  mockUnlisten: vi.fn(),
  // Backs the "sessions_list" invoke response. Kept in sync with whatever a
  // test seeds into the store, so the panel's own on-mount refresh resolves
  // to the same fixture instead of clobbering it with stale/empty data.
  sessionsFixture: { current: [] as SessionSummary[] },
  // When set, "sessions_delete" rejects — for the failure-surfacing tests.
  deleteFailure: { current: false },
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: unknown) => {
    // Only forward a second argument when the call actually passed one, so
    // existing `toHaveBeenCalledWith(cmd)` assertions (no args) still match
    // an exact single-argument call.
    if (args === undefined) {
      mockInvoke(cmd);
    } else {
      mockInvoke(cmd, args);
    }
    if (cmd === "sessions_list") {
      return Promise.resolve(sessionsFixture.current);
    }
    if (cmd === "sessions_delete" && deleteFailure.current) {
      return Promise.reject(new Error("trash failed"));
    }
    return Promise.resolve(undefined);
  },
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: mockListen,
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

/** Seeds both the store and the mocked backend response, so the panel's own
 *  fire-and-forget `start()` on mount can't race the test with different data. */
function seedSessions(sessions: SessionSummary[]) {
  sessionsFixture.current = sessions;
  useSessionsStore.setState({ sessions, loaded: true });
}

/** Renders the panel and waits for its on-mount `start()` (and the resulting
 *  `refresh()`) to settle, so later assertions never race a pending state
 *  update — and so that update happens inside `waitFor`'s act() wrapper. */
async function renderSettled() {
  const result = render(<SessionsPanel />);
  await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith("sessions_index_start"));
  return result;
}

describe("SessionsPanel", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockListen.mockReset().mockResolvedValue(mockUnlisten);
    mockUnlisten.mockReset();
    sessionsFixture.current = [];
    deleteFailure.current = false;
    useSessionsStore.setState({
      sessions: [],
      loaded: false,
      query: "",
      agentFilter: "all",
      modelFilter: "all",
      selectedId: null,
    });
    useTabsStore.setState({ spaces: [], activeSpaceId: null, tabs: [], activeId: null });
    useSessionStatusStore.setState({ statuses: {}, agents: {} });
  });

  it("starts the backend index and subscribes to updates on mount", async () => {
    await renderSettled();
    expect(mockListen).toHaveBeenCalledWith("sessions-index:updated", expect.any(Function));
  });

  it("shows the indexing placeholder before the store has loaded", async () => {
    render(<SessionsPanel />);
    // Assert before the on-mount start()/refresh() pipeline can resolve.
    expect(screen.getByText("sessions.indexing")).toBeInTheDocument();
    // Then drain it under act(), so it can't update state after this test
    // ends and spill an act() warning into whichever test runs next.
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith("sessions_index_start"));
  });

  it("shows the empty state once loaded with no sessions", async () => {
    seedSessions([]);
    await renderSettled();
    expect(screen.getByText("sessions.empty")).toBeInTheDocument();
  });

  it("renders pinned and history sections with agent badge, project, and message count", async () => {
    const pinnedSession = session({
      id: "p1",
      title: "Fix flaky test",
      pinned: true,
      agent: "codex",
      project_cwd: "/Users/muki/tempo-term",
      message_count: 4,
    });
    const historySession = session({
      id: "h1",
      title: "Refactor bridge",
      agent: "claude",
      message_count: 2,
    });
    seedSessions([pinnedSession, historySession]);

    await renderSettled();

    expect(screen.getByText("sessions.pinned")).toBeInTheDocument();
    expect(screen.getByText("Fix flaky test")).toBeInTheDocument();
    // Agent labels also appear as filter-chip button labels, so scope the
    // badge assertion to the <span> the row renders it in.
    expect(screen.getByText("sessions.agents.codex", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByText("Refactor bridge")).toBeInTheDocument();
    expect(screen.getByText("sessions.agents.claude", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByText(/tempo-term/)).toBeInTheDocument();
    expect(screen.getByText(/sessions\.messages:4/)).toBeInTheDocument();
  });

  it("filters the list as the search query changes", async () => {
    seedSessions([
      session({ id: "a", title: "Deploy script" }),
      session({ id: "b", title: "Unrelated" }),
    ]);
    await renderSettled();

    fireEvent.change(screen.getByPlaceholderText("sessions.searchPlaceholder"), {
      target: { value: "deploy" },
    });

    expect(screen.getByText("Deploy script")).toBeInTheDocument();
    expect(screen.queryByText("Unrelated")).not.toBeInTheDocument();
  });

  it("filters the list by agent chip", async () => {
    seedSessions([
      session({ id: "a", title: "Claude session", agent: "claude" }),
      session({ id: "b", title: "Codex session", agent: "codex" }),
    ]);
    await renderSettled();

    fireEvent.click(screen.getByRole("button", { name: "sessions.agents.codex", pressed: false }));

    expect(screen.getByText("Codex session")).toBeInTheDocument();
    expect(screen.queryByText("Claude session")).not.toBeInTheDocument();
  });

  it("resets a stale model filter to \"all\" once its model drops out of the option list", async () => {
    seedSessions([
      session({ id: "a", title: "GPT session", model: "gpt-5.5" }),
      session({ id: "b", title: "No-model session", model: null }),
    ]);
    await renderSettled();
    act(() => {
      useSessionsStore.setState({ modelFilter: "gpt-5.5" });
    });

    // Simulate a refresh (e.g. the session was deleted or re-indexed) that
    // drops the only session carrying "gpt-5.5" out of the list, so the
    // filter no longer matches any option.
    act(() => {
      useSessionsStore.setState({
        sessions: [session({ id: "b", title: "No-model session", model: null })],
      });
    });

    expect(useSessionsStore.getState().modelFilter).toBe("all");
  });

  it("selects a session on row click", async () => {
    seedSessions([session({ id: "a", title: "Deploy script" })]);
    await renderSettled();

    fireEvent.click(screen.getByText("Deploy script"));

    expect(useSessionsStore.getState().selectedId).toBe("a");
    // The selected row's button is announced as current to assistive tech.
    expect(screen.getByText("Deploy script").closest("button")).toHaveAttribute(
      "aria-current",
      "true",
    );
  });

  it("opens the sessions content tab on row click, reusing it on a second click", async () => {
    seedSessions([
      session({ id: "a", title: "Deploy script" }),
      session({ id: "b", title: "Refactor bridge" }),
    ]);
    await renderSettled();

    fireEvent.click(screen.getByText("Deploy script"));
    const tabId = useTabsStore.getState().activeId;
    expect(useTabsStore.getState().tabs).toHaveLength(1);
    expect(useTabsStore.getState().tabs[0].kind).toBe("sessions");

    fireEvent.click(screen.getByText("Refactor bridge"));
    // Selecting a second session focuses the same singleton tab instead of
    // opening a new one.
    expect(useSessionsStore.getState().selectedId).toBe("b");
    expect(useTabsStore.getState().tabs).toHaveLength(1);
    expect(useTabsStore.getState().activeId).toBe(tabId);
  });

  it("opens the dashboard tab (no session selected) via the header button", async () => {
    seedSessions([session({ id: "a", title: "Deploy script" })]);
    await renderSettled();

    fireEvent.click(screen.getByRole("button", { name: "sessions.dashboard.open" }));

    // A sessions tab opens with nothing selected, so it shows the dashboard.
    expect(useTabsStore.getState().tabs).toHaveLength(1);
    expect(useTabsStore.getState().tabs[0].kind).toBe("sessions");
    expect(useSessionsStore.getState().selectedId).toBe(null);
  });

  it("toggles pin via the row's pin button without selecting the row", async () => {
    seedSessions([session({ id: "a", title: "Deploy script", pinned: false })]);
    await renderSettled();

    fireEvent.click(screen.getByRole("button", { name: "sessions.pin" }));

    expect(useSessionsStore.getState().selectedId).toBe(null);
    expect(useSessionsStore.getState().sessions[0].pinned).toBe(true);
  });

  it("resumes a session via the row's resume button without selecting the row", async () => {
    seedSessions([session({ id: "a", agent: "claude", project_cwd: "/repo/app" })]);
    await renderSettled();

    fireEvent.click(screen.getByRole("button", { name: "sessions.resume" }));

    expect(useSessionsStore.getState().selectedId).toBe(null);
    const tabs = useTabsStore.getState().tabs;
    expect(tabs).toHaveLength(1);
    expect(tabs[0].kind).toBe("terminal");
    expect(tabs[0].cwd).toBe("/repo/app");
  });

  it("clicks the project name to open the project view without selecting the session", async () => {
    seedSessions([
      session({ id: "a", title: "Deploy script", project_cwd: "/Users/muki/tempo-term" }),
    ]);
    await renderSettled();

    fireEvent.click(screen.getByText("tempo-term"));

    expect(useSessionsStore.getState().selectedProject).toBe("/Users/muki/tempo-term");
    // The row's own select(id) must not have fired.
    expect(useSessionsStore.getState().selectedId).toBe(null);
  });

  it("activates the project name via keyboard without selecting the session", async () => {
    seedSessions([
      session({ id: "a", title: "Deploy script", project_cwd: "/Users/muki/tempo-term" }),
    ]);
    await renderSettled();

    fireEvent.keyDown(screen.getByText("tempo-term"), { key: "Enter" });

    expect(useSessionsStore.getState().selectedProject).toBe("/Users/muki/tempo-term");
    expect(useSessionsStore.getState().selectedId).toBe(null);
  });

  it("renders no clickable project element when project_cwd is empty", async () => {
    seedSessions([session({ id: "a", title: "Deploy script", project_cwd: "" })]);
    await renderSettled();

    expect(screen.queryByRole("button", { name: "" })).not.toBeInTheDocument();
    // basename("") falls back to "" too, so there's simply nothing to click;
    // the rest of the meta line (time · message count) still renders.
    expect(screen.getByText(/sessions\.messages:0/)).toBeInTheDocument();
  });

  it("hides the resume button on rows for agents with no supported resume command", async () => {
    seedSessions([session({ id: "a", agent: "antigravity" })]);
    await renderSettled();

    expect(screen.queryByRole("button", { name: "sessions.resume" })).not.toBeInTheDocument();
  });

  it("unsubscribes from session updates on unmount", async () => {
    const { unmount } = await renderSettled();
    await waitFor(() => expect(mockListen).toHaveBeenCalled());

    unmount();

    expect(mockUnlisten).toHaveBeenCalled();
  });

  it("hides the Live section when nothing is running", async () => {
    await renderSettled();
    expect(screen.queryByText("sessions.live")).not.toBeInTheDocument();
  });

  it("shows a running session in the Live section and jumps to its pane on click", async () => {
    const tab: Tab = {
      id: "tab-1",
      spaceId: "space-1",
      title: "My Terminal",
      kind: "terminal",
      paneTree: leaf("leaf-1", { kind: "terminal", cwd: "/proj" }),
      activeLeafId: "leaf-1",
      paneOrder: ["leaf-1"],
    };
    useTabsStore.setState({
      spaces: [{ id: "space-1", name: "Space" }],
      activeSpaceId: "space-1",
      tabs: [tab],
      activeId: null,
    });
    useSessionStatusStore.setState({
      statuses: { "leaf-1": "thinking" },
      agents: { "leaf-1": "claude" },
    });

    await renderSettled();

    expect(screen.getByText("sessions.live")).toBeInTheDocument();
    expect(screen.getByText("My Terminal")).toBeInTheDocument();
    expect(screen.getByText("sessions.agents.claude", { selector: "span" })).toBeInTheDocument();

    fireEvent.click(screen.getByText("My Terminal"));

    expect(useTabsStore.getState().activeId).toBe("tab-1");
    expect(useTabsStore.getState().tabs[0].activeLeafId).toBe("leaf-1");
  });

  it("opens a confirm dialog from the row's delete button instead of deleting immediately", async () => {
    seedSessions([session({ id: "a", title: "Deploy script" })]);
    await renderSettled();

    fireEvent.click(screen.getByRole("button", { name: "sessions.delete" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("sessions.deleteConfirm")).toBeInTheDocument();
    expect(mockInvoke).not.toHaveBeenCalledWith("sessions_delete", expect.anything());
  });

  it("does nothing when the row's delete confirmation is cancelled", async () => {
    seedSessions([session({ id: "a", title: "Deploy script" })]);
    await renderSettled();

    fireEvent.click(screen.getByRole("button", { name: "sessions.delete" }));
    fireEvent.click(screen.getByRole("button", { name: "actions.cancel" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mockInvoke).not.toHaveBeenCalledWith("sessions_delete", expect.anything());
  });

  it("deletes the session and clears the selection when it was selected, on confirm", async () => {
    seedSessions([session({ id: "a", title: "Deploy script" })]);
    await renderSettled();
    act(() => {
      useSessionsStore.setState({ selectedId: "a" });
    });

    fireEvent.click(screen.getByRole("button", { name: "sessions.delete" }));
    const dialog = screen.getByRole("dialog");
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "sessions.delete" }));
      // Flush the microtask queue past `sessionsDelete`'s own `await` inside
      // `handleDelete`, so the resulting `select(null)` state update lands
      // inside this `act` scope instead of after it.
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(mockInvoke).toHaveBeenCalledWith("sessions_delete", { id: "a" });
    expect(useSessionsStore.getState().selectedId).toBe(null);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("leaves the selection untouched when the deleted session was not selected", async () => {
    seedSessions([
      session({ id: "a", title: "Deploy script" }),
      session({ id: "b", title: "Other session" }),
    ]);
    await renderSettled();
    act(() => {
      useSessionsStore.setState({ selectedId: "b" });
    });

    fireEvent.click(screen.getAllByRole("button", { name: "sessions.delete" })[0]);
    const dialog = screen.getByRole("dialog");
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "sessions.delete" }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(mockInvoke).toHaveBeenCalledWith("sessions_delete", { id: "a" });
    expect(useSessionsStore.getState().selectedId).toBe("b");
  });

  it("shows an error line and keeps the row and selection when the delete fails", async () => {
    seedSessions([session({ id: "a", title: "Deploy script" })]);
    await renderSettled();
    act(() => {
      useSessionsStore.setState({ selectedId: "a" });
    });
    deleteFailure.current = true;

    fireEvent.click(screen.getByRole("button", { name: "sessions.delete" }));
    const dialog = screen.getByRole("dialog");
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "sessions.delete" }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // The failure is surfaced, and nothing else changed: the row is still
    // listed and the selection was not cleared.
    expect(screen.getByText("sessions.deleteError")).toBeInTheDocument();
    expect(screen.getByText("Deploy script")).toBeInTheDocument();
    expect(useSessionsStore.getState().selectedId).toBe("a");
  });

  it("clears the delete error line when a new delete attempt starts", async () => {
    seedSessions([session({ id: "a", title: "Deploy script" })]);
    await renderSettled();
    deleteFailure.current = true;

    fireEvent.click(screen.getByRole("button", { name: "sessions.delete" }));
    await act(async () => {
      fireEvent.click(
        within(screen.getByRole("dialog")).getByRole("button", { name: "sessions.delete" }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.getByText("sessions.deleteError")).toBeInTheDocument();

    // Re-opening the confirm dialog starts a fresh attempt: stale error gone.
    fireEvent.click(screen.getByRole("button", { name: "sessions.delete" }));

    expect(screen.queryByText("sessions.deleteError")).not.toBeInTheDocument();
  });

  it("releases the listener when unmounted before the subscription resolves", async () => {
    // Hold the listen promise open so unmount happens first — the race that
    // fast sidebar-tab switching hits in the real app.
    let resolveListen!: (fn: () => void) => void;
    mockListen.mockImplementation(
      () =>
        new Promise<() => void>((resolve) => {
          resolveListen = resolve;
        }),
    );
    const { unmount } = render(<SessionsPanel />);

    unmount();
    expect(mockUnlisten).not.toHaveBeenCalled();

    resolveListen(mockUnlisten);

    // The late-arriving unlisten fn must still be invoked, not leaked.
    await waitFor(() => expect(mockUnlisten).toHaveBeenCalled());
  });
});
