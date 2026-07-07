import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardView } from "./DashboardView";
import { useSessionsStore } from "./lib/sessionsStore";
import type { SessionSummary } from "./lib/sessionsBridge";
import type { SessionsStats } from "./lib/statsBridge";

// vi.mock is hoisted to the top of the file, so mocks must be created with
// vi.hoisted() to be accessible inside the factory callbacks.
const { mockInvoke, mockListen, mockUnlisten, mockSaveFile, mockFsWriteFile, statsFixture } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  mockListen: vi.fn(),
  mockUnlisten: vi.fn(),
  // Backs the CSV export button's save dialog + file write.
  mockSaveFile: vi.fn(),
  mockFsWriteFile: vi.fn(),
  // Backs the "sessions_stats" invoke response, seeded per test.
  statsFixture: { current: null as unknown },
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) => {
    mockInvoke(cmd, args);
    if (cmd === "sessions_stats") {
      return Promise.resolve(statsFixture.current);
    }
    return Promise.resolve(undefined);
  },
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: mockListen,
}));

vi.mock("@/lib/dialog", () => ({
  saveFile: mockSaveFile,
}));

vi.mock("@/modules/explorer/lib/fsBridge", () => ({
  fsWriteFile: mockFsWriteFile,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts?.count !== undefined ? `${key}:${opts.count}` : key,
    i18n: { language: "en" },
  }),
}));

function stats(overrides: Partial<SessionsStats> = {}): SessionsStats {
  return {
    cards: {
      sessions: 12,
      messages: 340,
      user_messages: 150,
      projects: 4,
      active_days: 9,
      messages_per_session: 28.3333,
      output_tokens: 12500,
    },
    heatmap: [
      { date: "2026-07-01", messages: 5, sessions: 2, output_tokens: 800 },
      { date: "2026-07-02", messages: 12, sessions: 3, output_tokens: 2100 },
    ],
    top_by_messages: [
      { id: "s1", agent: "claude", title: "Fix flaky test", project_cwd: "/repo/app", value: 42 },
    ],
    top_by_tokens: [
      { id: "s2", agent: "codex", title: "Refactor bridge", project_cwd: "/repo/app2", value: 900 },
    ],
    weekly: [
      {
        agent: "claude",
        sessions: 3,
        messages: 80,
        output_tokens: 500,
        models: [{ model: "claude-sonnet-5", output_tokens: 500 }],
      },
    ],
    range_models: [{ model: "claude-sonnet-5", output_tokens: 12500 }],
    hourly: new Array(24).fill(0),
    ...overrides,
  };
}

function session(overrides: Partial<SessionSummary>): SessionSummary {
  return {
    id: "id",
    agent: "claude",
    project_cwd: "/p",
    title: "t",
    started_at: 0,
    ended_at: 0,
    message_count: 0,
    user_message_count: 0,
    output_tokens: null,
    model: null,
    file_path: "/f",
    pinned: false,
    ...overrides,
  };
}

describe("DashboardView", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockListen.mockReset().mockResolvedValue(mockUnlisten);
    mockUnlisten.mockReset();
    mockSaveFile.mockReset();
    mockFsWriteFile.mockReset().mockResolvedValue(undefined);
    statsFixture.current = stats();
    useSessionsStore.setState({
      sessions: [],
      loaded: false,
      query: "",
      agentFilter: "all",
      modelFilter: "all",
      selectedId: null,
    });
  });

  it("fetches stats on mount for the default range and renders card values", async () => {
    render(<DashboardView />);

    expect(mockInvoke).toHaveBeenCalledWith("sessions_stats", { days: 365 });
    // The single card row: sessions / messages / projects / active days / cost.
    await waitFor(() => expect(screen.getByText("12")).toBeInTheDocument());
    expect(screen.getByText("340")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("9")).toBeInTheDocument();
    // Cost card prices the fixture's 12,500 sonnet tokens (15 $/Mtok), labelled US$.
    expect(screen.getByText("≈ US$ 0.19")).toBeInTheDocument();
  });

  it("refetches with the chosen range when a chip is clicked", async () => {
    render(<DashboardView />);
    await waitFor(() => expect(screen.getByText("12")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "sessions.dashboard.range30" }));
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith("sessions_stats", { days: 30 }));

    fireEvent.click(screen.getByRole("button", { name: "sessions.dashboard.rangeAll" }));
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith("sessions_stats", { days: null }));
  });

  it("shows top-by-messages rows by default and switches to top-by-tokens on tab click", async () => {
    render(<DashboardView />);

    await waitFor(() => expect(screen.getByText("Fix flaky test")).toBeInTheDocument());
    expect(screen.queryByText("Refactor bridge")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "sessions.dashboard.topByTokens" }));

    expect(screen.getByText("Refactor bridge")).toBeInTheDocument();
    expect(screen.queryByText("Fix flaky test")).not.toBeInTheDocument();
  });

  it("selects a session when a top-sessions row is clicked", async () => {
    render(<DashboardView />);
    await waitFor(() => expect(screen.getByText("Fix flaky test")).toBeInTheDocument());

    fireEvent.click(screen.getByText("Fix flaky test"));

    expect(useSessionsStore.getState().selectedId).toBe("s1");
  });

  it("clicks a top-sessions row's project name to open the project view without selecting the session", async () => {
    render(<DashboardView />);
    await waitFor(() => expect(screen.getByText("Fix flaky test")).toBeInTheDocument());

    fireEvent.click(screen.getByText("/repo/app"));

    expect(useSessionsStore.getState().selectedProject).toBe("/repo/app");
    // The row's own onSelect(session.id) must not have fired.
    expect(useSessionsStore.getState().selectedId).toBe(null);
  });

  it("renders no clickable project element when a top-sessions row's project_cwd is empty", async () => {
    statsFixture.current = stats({
      top_by_messages: [
        { id: "s1", agent: "claude", title: "Fix flaky test", project_cwd: "", value: 42 },
      ],
    });
    render(<DashboardView />);

    await waitFor(() => expect(screen.getByText("Fix flaky test")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "" })).not.toBeInTheDocument();
  });

  it("renders the weekly digest with per-agent sessions/messages/tokens", async () => {
    render(<DashboardView />);

    // The agent badge also appears on the top-sessions row, so scope to the
    // weekly digest table's data row specifically.
    await waitFor(() => expect(screen.getByText("sessions.dashboard.weeklyTitle")).toBeInTheDocument());
    const weeklyRow = screen.getByRole("table").querySelector("tbody tr");
    // Agent, sessions, messages, tokens, cost as labelled table cells. The
    // fixture's known model (sonnet-5) with 500 tokens costs ≈ $0.01.
    expect(weeklyRow?.textContent).toBe("sessions.agents.claude380500≈ $0.01");
  });

  it("shows ≈ $0.00+ when a weekly row has only unpriced-model tokens", async () => {
    statsFixture.current = stats({
      weekly: [
        {
          agent: "claude",
          sessions: 2,
          messages: 40,
          output_tokens: 1200,
          models: [{ model: "mystery-model-x", output_tokens: 1200 }],
        },
      ],
    });
    render(<DashboardView />);

    await waitFor(() =>
      expect(screen.getByText("sessions.dashboard.weeklyTitle")).toBeInTheDocument(),
    );
    const weeklyRow = screen.getByRole("table").querySelector("tbody tr");
    // All tokens are unpriced: the cost cell must still render, as a $0.00
    // floor with the "+" marker — not a dash. Tokens compact to "1.2K".
    expect(weeklyRow?.textContent).toBe("sessions.agents.claude2401.2K≈ $0.00+");
  });

  it("labels heatmap cells with the date · metric count (via our Tooltip)", async () => {
    render(<DashboardView />);

    // Cells carry an aria-label (queryable + accessible); the visual tooltip
    // is our portal Tooltip component, not the native `title`. The mocked `t`
    // echoes `key:count`; default metric is messages, so the busiest day (12).
    await waitFor(() =>
      expect(
        screen.getByLabelText("sessions.dashboard.heatmapTooltip:12"),
      ).toBeInTheDocument(),
    );
  });

  it("switches the heatmap metric to output tokens on toggle", async () => {
    render(<DashboardView />);
    await waitFor(() =>
      expect(screen.getByLabelText("sessions.dashboard.heatmapTooltip:12")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "sessions.dashboard.metricTokens" }));

    // The label now reflects that day's output tokens (2100), not messages.
    await waitFor(() =>
      expect(screen.getByLabelText("sessions.dashboard.heatmapTooltip:2100")).toBeInTheDocument(),
    );
  });

  it("keeps a single sessions-index:updated subscription across range changes", async () => {
    render(<DashboardView />);
    await waitFor(() => expect(mockListen).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "sessions.dashboard.range30" }));
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith("sessions_stats", { days: 30 }));

    // Changing the range refetches but must not tear down and re-create the
    // event listener.
    expect(mockListen).toHaveBeenCalledTimes(1);
    expect(mockUnlisten).not.toHaveBeenCalled();
  });

  it("refetches with the current range when a sessions-index:updated event fires", async () => {
    render(<DashboardView />);
    await waitFor(() => expect(mockListen).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "sessions.dashboard.range30" }));
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith("sessions_stats", { days: 30 }));
    mockInvoke.mockClear();

    // Fire the event callback the component registered on mount — the
    // refetch must use the range selected *after* subscribing, not a stale
    // closure over the initial one.
    const callback = mockListen.mock.calls[0][1] as () => void;
    callback();

    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith("sessions_stats", { days: 30 }));
  });

  it("subscribes to sessions-index:updated and releases the listener on unmount", async () => {
    const { unmount } = render(<DashboardView />);
    await waitFor(() => expect(mockListen).toHaveBeenCalledWith("sessions-index:updated", expect.any(Function)));

    unmount();

    expect(mockUnlisten).toHaveBeenCalled();
  });

  it("releases the listener when unmounted before the subscription resolves", async () => {
    let resolveListen!: (fn: () => void) => void;
    mockListen.mockImplementation(
      () =>
        new Promise<() => void>((resolve) => {
          resolveListen = resolve;
        }),
    );
    const { unmount } = render(<DashboardView />);

    unmount();
    expect(mockUnlisten).not.toHaveBeenCalled();

    resolveListen(mockUnlisten);

    await waitFor(() => expect(mockUnlisten).toHaveBeenCalled());
  });

  it("exports only the filtered session list as CSV via saveFile + fsWriteFile", async () => {
    // Two sessions that only the agent filter distinguishes: with
    // agentFilter:"codex" the export must include the kept row and exclude
    // the other one, proving it serializes the filtered list, not raw `sessions`.
    useSessionsStore.setState({
      sessions: [
        session({ id: "a", title: "Keep me", agent: "codex", model: "gpt-5.5" }),
        session({ id: "b", title: "Drop me", agent: "claude", model: "claude-sonnet-5" }),
      ],
      query: "",
      agentFilter: "codex",
      modelFilter: "all",
    });
    mockSaveFile.mockResolvedValue("/path.csv");

    render(<DashboardView />);
    await waitFor(() => expect(screen.getByText("12")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "sessions.dashboard.exportCsv" }));

    await waitFor(() =>
      expect(mockSaveFile).toHaveBeenCalledWith("ai-sessions.csv", [{ name: "CSV", extensions: ["csv"] }]),
    );
    await waitFor(() => expect(mockFsWriteFile).toHaveBeenCalledWith("/path.csv", expect.any(String)));

    const csv = mockFsWriteFile.mock.calls[0][1] as string;
    expect(csv).toContain("Keep me");
    expect(csv).not.toContain("Drop me");
  });
});
