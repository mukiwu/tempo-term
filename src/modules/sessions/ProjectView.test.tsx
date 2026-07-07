import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectView } from "./ProjectView";
import { useSessionsStore } from "./lib/sessionsStore";

const { mockInvoke, mockOpenTerminal } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  mockOpenTerminal: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) => {
    mockInvoke(cmd, args);
    if (cmd === "sessions_project_stats") {
      return Promise.resolve({
        project_cwd: "/tmp/proj-a",
        sessions: 2,
        messages: 14,
        output_tokens: 100,
        // Deliberately distinct from `sessions` (2) — DashboardView.test.tsx
        // follows the same convention (distinct mock numbers per stat) so
        // `screen.getByText("2")` below resolves to a single element.
        active_days: 5,
        top_model: "claude-sonnet-5",
        first_at: 1000,
        last_at: 2000,
        recent: [
          { id: "s1", agent: "claude", project_cwd: "/tmp/proj-a", title: "Fix bug",
            started_at: 1000, ended_at: 2000, message_count: 10, user_message_count: 5,
            output_tokens: 100, model: "claude-sonnet-5", file_path: "/f/s1.jsonl", pinned: false },
        ],
      });
    }
    return Promise.resolve(undefined);
  },
}));

vi.mock("./lib/openTerminalAt", () => ({ openTerminalAt: mockOpenTerminal }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string, o?: Record<string, unknown>) =>
    o?.count !== undefined ? `${k}:${o.count}` : k, i18n: { language: "en" } }),
}));

describe("ProjectView", () => {
  beforeEach(() => {
    mockInvoke.mockClear();
    mockOpenTerminal.mockClear();
    useSessionsStore.setState({ selectedProject: "/tmp/proj-a", selectedId: null });
  });

  it("fetches and renders the project's aggregates and recent sessions", async () => {
    render(<ProjectView />);
    expect(mockInvoke).toHaveBeenCalledWith("sessions_project_stats", { projectCwd: "/tmp/proj-a" });
    await waitFor(() => expect(screen.getByText("2")).toBeInTheDocument());
    expect(screen.getByText("14")).toBeInTheDocument();
    expect(screen.getByText("claude-sonnet-5")).toBeInTheDocument();
    expect(screen.getByText("Fix bug")).toBeInTheDocument();
  });

  it("opens a terminal at the project cwd when the button is clicked", async () => {
    render(<ProjectView />);
    await waitFor(() => expect(screen.getByText("2")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "sessions.project.openTerminal" }));
    expect(mockOpenTerminal).toHaveBeenCalledWith("/tmp/proj-a");
  });

  it("returns to the dashboard when back is clicked", async () => {
    render(<ProjectView />);
    await waitFor(() => expect(screen.getByText("2")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "sessions.project.back" }));
    expect(useSessionsStore.getState().selectedProject).toBeNull();
  });

  it("selects a recent session into the viewer when its row is clicked", async () => {
    render(<ProjectView />);
    await waitFor(() => expect(screen.getByText("Fix bug")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Fix bug"));
    expect(useSessionsStore.getState().selectedId).toBe("s1");
  });
});
