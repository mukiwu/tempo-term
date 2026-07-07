# AI Sessions View P3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a project-view screen, session↔git-commit correlation, a model filter, and CSV export to the AI Sessions view, reusing P1/P2 patterns.

**Architecture:** One new backend aggregate command (`sessions_project_stats`) and one new git command (`git_commits_in_range`) on the existing Rust modules; a third main-area screen routed off a new `selectedProject` store field; a model filter mirroring the existing agent filter; and a pure-frontend CSV builder wired to a filter-aware save dialog.

**Tech Stack:** Tauri 2 (Rust, rusqlite), React 19 + zustand + Tailwind v4, vitest + cargo test. Work in the dev worktree `/Users/muki/Documents/01.project/tempo-term-dev`, branch `feat/ai-sessions-p3` (already checked out, based on master c08c9df).

## Global Constraints

- Zero new npm packages, zero new Rust crates. Git reuses `src-tauri/src/modules/git/mod.rs`; CSV is hand-built; project view and model filter are hand-rolled UI over existing stores.
- Commit messages / PR / issues / code comments / review replies in English; user-facing conversation in Traditional Chinese.
- All user-visible strings go through i18next in BOTH `src/i18n/locales/en/common.json` and `src/i18n/locales/zh-Hant/common.json`.
- Every change goes through the PR (branch `feat/ai-sessions-p3`), never a direct push to master.
- Conventional-commit messages; no AI attribution.
- Serde field names are snake_case and must match the TS bridge types verbatim (no mapping layer).
- ⚠️ `CommitInfo.timestamp` is epoch **seconds** (`%ct`); session `started_at`/`ended_at` are epoch **milliseconds**. Convert ms→seconds (`ms / 1000`) before passing to git.
- Everything degrades quietly: unknown project → zeroed stats; non-git/remote/failed cwd → empty commit list (section hidden); empty CSV → header-only file; cancelled save dialog → no-op. Git is read-only.

---

## File Structure

**Backend**
- `src-tauri/src/modules/sessions_index/stats.rs` — add `ProjectStats` struct + `Index::project_stats(cwd)` method + tests (Task 1).
- `src-tauri/src/modules/sessions_index/mod.rs` — add `sessions_project_stats` command wrapper (Task 1).
- `src-tauri/src/modules/git/mod.rs` — add `git_commits_in_range` command + tests (Task 3).
- `src-tauri/src/lib.rs` — register both new commands in the invoke handler (Tasks 1, 3).

**Frontend**
- `src/modules/sessions/lib/projectBridge.ts` (new) — `ProjectStats` type + `sessionsProjectStats(cwd)` wrapper (Task 1).
- `src/modules/sessions/lib/sessionsStore.ts` — add `selectedProject`/`selectProject`, `modelFilter`/`setModelFilter`, extend `visibleSessions` (Tasks 2, 4).
- `src/modules/sessions/ProjectView.tsx` (new) + `.test.tsx` — the third screen (Task 2).
- `src/modules/sessions/lib/openTerminalAt.ts` (new) + `.test.ts` — open a terminal tab at a cwd (Task 2).
- `src/modules/sessions/SessionsTabContent.tsx` — add the project-view routing branch (Task 2).
- `src/modules/sessions/SessionsPanel.tsx` — clickable project name → `selectProject`; model filter dropdown (Tasks 2, 4).
- `src/modules/sessions/DashboardView.tsx` — clickable project on Top Sessions rows; CSV export button (Tasks 2, 5).
- `src/modules/source-control/lib/gitBridge.ts` — add `gitCommitsInRange(cwd, sinceMs, untilMs)` wrapper (Task 3).
- `src/modules/sessions/lib/gitCorrelation.ts` (new) is NOT needed — the viewer calls `gitCommitsInRange` directly.
- `src/modules/sessions/lib/sessionsCsv.ts` (new) + `.test.ts` — `toSessionsCsv(sessions)` (Task 5).
- `src/lib/dialog.ts` — add an optional `filters` param to `saveFile` (Task 5).
- Both locale files — new keys under `sessions.project.*`, `sessions.commits.*`, `sessions.modelFilterAll`, `sessions.dashboard.exportCsv` (Tasks 2-5).

---

## Task 1: `sessions_project_stats` backend command

**Files:**
- Modify: `src-tauri/src/modules/sessions_index/stats.rs` (add `ProjectStats`, `Index::project_stats`, tests)
- Modify: `src-tauri/src/modules/sessions_index/mod.rs` (add command wrapper)
- Modify: `src-tauri/src/lib.rs:60` (import) and `:262` (handler list)
- Create: `src/modules/sessions/lib/projectBridge.ts` (TS type + wrapper)

**Interfaces:**
- Consumes: existing `Index`, `SessionSummary` (types.rs), `stats::empty_stats` pattern, the `sessions_stats` command shape (mod.rs:333-350).
- Produces:
  - Rust `ProjectStats { project_cwd: String, sessions: i64, messages: i64, output_tokens: i64, active_days: i64, top_model: Option<String>, first_at: i64, last_at: i64, recent: Vec<SessionSummary> }`
  - Rust command `sessions_project_stats(state, project_cwd: String) -> Result<ProjectStats, String>`
  - TS `ProjectStats` (same fields, snake_case) + `sessionsProjectStats(projectCwd: string): Promise<ProjectStats>` invoking `"sessions_project_stats"` with `{ projectCwd }`.

- [ ] **Step 1: Write the failing Rust test**

Add to the `#[cfg(test)] mod tests` in `stats.rs` (the `seeded_index` fixture has proj-a with s1 today + s3 40d ago, proj-b with s2 3d ago):

```rust
#[test]
fn project_stats_aggregates_only_that_project() {
    let index = seeded_index("proj-stats");
    let ps = index.project_stats("/tmp/proj-a");
    // proj-a = s1 (10 msg, 100 tok, sonnet-5, today) + s3 (4 msg, 0 tok, 40d ago).
    assert_eq!(ps.project_cwd, "/tmp/proj-a");
    assert_eq!(ps.sessions, 2);
    assert_eq!(ps.messages, 14);
    assert_eq!(ps.output_tokens, 100);
    assert_eq!(ps.active_days, 2);
    assert_eq!(ps.top_model.as_deref(), Some("claude-sonnet-5"));
    // recent is newest-first by ended_at; both fixture sessions share ended_at,
    // so just assert membership and count.
    assert_eq!(ps.recent.len(), 2);
    assert!(ps.recent.iter().all(|s| s.project_cwd == "/tmp/proj-a"));
}

#[test]
fn project_stats_is_zeroed_for_an_unknown_project() {
    let index = seeded_index("proj-stats-none");
    let ps = index.project_stats("/tmp/does-not-exist");
    assert_eq!(ps.sessions, 0);
    assert_eq!(ps.messages, 0);
    assert_eq!(ps.output_tokens, 0);
    assert_eq!(ps.active_days, 0);
    assert_eq!(ps.top_model, None);
    assert_eq!(ps.first_at, 0);
    assert_eq!(ps.last_at, 0);
    assert!(ps.recent.is_empty());
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd src-tauri && cargo test sessions_index::stats::tests::project_stats 2>&1 | tail -20`
Expected: FAIL — `no method named project_stats` / `cannot find type ProjectStats`.

- [ ] **Step 3: Add the `ProjectStats` struct and `Index::project_stats`**

In `stats.rs`, near the other serde structs, add (import `SessionSummary` if not already in scope — it lives in `super::types`):

```rust
#[derive(Debug, Clone, serde::Serialize)]
pub struct ProjectStats {
    pub project_cwd: String,
    pub sessions: i64,
    pub messages: i64,
    pub output_tokens: i64,
    pub active_days: i64,
    /// Model used in the most sessions in this project (ties by model name),
    /// or None when no session here recorded a model.
    pub top_model: Option<String>,
    pub first_at: i64,
    pub last_at: i64,
    /// This project's sessions, newest first (capped at 50).
    pub recent: Vec<SessionSummary>,
}
```

Add the method to the same `impl Index` block that holds `stats`:

```rust
/// Per-project aggregates + this project's recent sessions. Filtered to
/// `project_cwd = ?1`. An unknown project yields zeroed counts and an empty
/// `recent` — never an error.
pub fn project_stats(&self, project_cwd: &str) -> ProjectStats {
    let (sessions, messages, output_tokens, first_at, last_at) = self
        .conn
        .query_row(
            "SELECT COUNT(*), COALESCE(SUM(message_count),0), COALESCE(SUM(output_tokens),0),
                    COALESCE(MIN(started_at),0), COALESCE(MAX(ended_at),0)
             FROM sessions WHERE project_cwd = ?1",
            params![project_cwd],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )
        .unwrap_or((0, 0, 0, 0, 0));

    let active_days = self
        .conn
        .query_row(
            "SELECT COUNT(DISTINCT a.date) FROM activity a
             JOIN sessions s ON s.id = a.session_id WHERE s.project_cwd = ?1",
            params![project_cwd],
            |r| r.get(0),
        )
        .unwrap_or(0);

    let top_model = self
        .conn
        .query_row(
            "SELECT model FROM sessions WHERE project_cwd = ?1 AND model IS NOT NULL
             GROUP BY model ORDER BY COUNT(*) DESC, model ASC LIMIT 1",
            params![project_cwd],
            |r| r.get(0),
        )
        .ok();

    let recent = self.list_for_project(project_cwd);

    ProjectStats {
        project_cwd: project_cwd.to_string(),
        sessions,
        messages,
        output_tokens,
        active_days,
        top_model,
        first_at,
        last_at,
        recent,
    }
}
```

Add a helper next to `Index::list()` in `index.rs` (mirror `list()`'s row mapping exactly — reuse its `SELECT` column list and `row_to_summary`/closure; the existing `list()` is at index.rs:140):

```rust
/// This project's sessions, newest first, capped at 50. Same row shape as
/// `list()`, filtered to one `project_cwd`.
pub fn list_for_project(&self, project_cwd: &str) -> Vec<SessionSummary> {
    // Copy list()'s SELECT column order and row mapping; add
    // `WHERE project_cwd = ?1 ORDER BY ended_at DESC LIMIT 50`.
    // (Fill in with list()'s exact SELECT + mapping closure.)
    let mut stmt = match self.conn.prepare(
        "SELECT <same columns as list()> FROM sessions
         WHERE project_cwd = ?1 ORDER BY ended_at DESC LIMIT 50",
    ) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };
    let rows = match stmt.query_map(params![project_cwd], /* same closure as list() */) {
        Ok(r) => r,
        Err(_) => return Vec::new(),
    };
    rows.filter_map(Result::ok).collect()
}
```

Note for implementer: open `index.rs:140` (`list()`), copy its exact `SELECT` column list and its row→`SessionSummary` mapping closure into `list_for_project` verbatim, changing only the `WHERE`/`ORDER BY`/`LIMIT`. Do not invent a new column order.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd src-tauri && cargo test sessions_index::stats::tests::project_stats 2>&1 | tail -20`
Expected: PASS (2 tests).

- [ ] **Step 5: Add the command wrapper**

In `mod.rs`, mirror `sessions_stats` (mod.rs:333):

```rust
/// Per-project aggregates + recent sessions for the project view. Offloaded to
/// a blocking pool thread like `sessions_stats`. Zeroed stats (never an error)
/// before the index has started or for an unknown project.
#[tauri::command]
pub async fn sessions_project_stats(
    state: State<'_, SessionsIndexState>,
    project_cwd: String,
) -> Result<stats::ProjectStats, String> {
    let index = {
        let guard = state.inner.lock().unwrap();
        guard.as_ref().map(|inner| Arc::clone(&inner.index))
    };
    let Some(index) = index else {
        return Ok(stats::ProjectStats {
            project_cwd,
            sessions: 0,
            messages: 0,
            output_tokens: 0,
            active_days: 0,
            top_model: None,
            first_at: 0,
            last_at: 0,
            recent: Vec::new(),
        });
    };
    tauri::async_runtime::spawn_blocking(move || index.lock().unwrap().project_stats(&project_cwd))
        .await
        .map_err(|e| e.to_string())
}
```

- [ ] **Step 6: Register the command in `lib.rs`**

At `lib.rs:60` add `sessions_project_stats` to the `use` list from the module (next to `sessions_stats`). At the handler list (`lib.rs:262`, next to `sessions_stats,`) add `sessions_project_stats,`.

- [ ] **Step 7: Create the frontend bridge**

Create `src/modules/sessions/lib/projectBridge.ts`:

```ts
import { invoke } from "@tauri-apps/api/core";
import type { SessionSummary } from "./sessionsBridge";

/** Per-project aggregates + recent sessions for the project view. Field names
 *  mirror the Rust `ProjectStats` serde output exactly. */
export interface ProjectStats {
  project_cwd: string;
  sessions: number;
  messages: number;
  output_tokens: number;
  active_days: number;
  top_model: string | null;
  first_at: number;
  last_at: number;
  recent: SessionSummary[];
}

/** Aggregates for one project. Zeroed (never rejects) for an unknown project. */
export function sessionsProjectStats(projectCwd: string): Promise<ProjectStats> {
  return invoke<ProjectStats>("sessions_project_stats", { projectCwd });
}
```

- [ ] **Step 8: Typecheck and build**

Run: `pnpm typecheck 2>&1 | tail -3 && cd src-tauri && cargo test sessions_index 2>&1 | grep "test result" | head -1`
Expected: typecheck clean; all sessions_index tests pass.

- [ ] **Step 9: Commit**

```bash
git add src-tauri/src/modules/sessions_index/stats.rs src-tauri/src/modules/sessions_index/index.rs src-tauri/src/modules/sessions_index/mod.rs src-tauri/src/lib.rs src/modules/sessions/lib/projectBridge.ts
git commit -m "feat(sessions): add sessions_project_stats command for the project view"
```

---

## Task 2: Project view screen + store + routing + clickable project names

**Files:**
- Modify: `src/modules/sessions/lib/sessionsStore.ts` (add `selectedProject`/`selectProject`; `select`/`selectProject` clear each other)
- Create: `src/modules/sessions/lib/openTerminalAt.ts` + `src/modules/sessions/lib/openTerminalAt.test.ts`
- Create: `src/modules/sessions/ProjectView.tsx` + `src/modules/sessions/ProjectView.test.tsx`
- Modify: `src/modules/sessions/SessionsTabContent.tsx:158` (route project view first)
- Modify: `src/modules/sessions/SessionsPanel.tsx` (project basename → `selectProject`)
- Modify: `src/modules/sessions/DashboardView.tsx` (Top Sessions project → `selectProject`)
- Modify: both locale files (`sessions.project.*`)

**Interfaces:**
- Consumes: `sessionsProjectStats` (Task 1), `useSessionsStore`, `useTabsStore.getState().newTerminalTab(cwd)` (tabsStore.ts:436).
- Produces:
  - store: `selectedProject: string | null`, `selectProject(cwd: string | null)` (sets `selectedProject`, clears `selectedId`); `select(id)` also clears `selectedProject`.
  - `openTerminalAt(cwd: string): string` — creates a terminal tab at cwd, returns its tabId.
  - `<ProjectView />` — reads `selectedProject`, fetches stats, renders tiles + back + open-terminal + recent list.

- [ ] **Step 1: Write the failing store test**

Add to `src/modules/sessions/lib/sessionsStore.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/modules/sessions/lib/sessionsStore.test.ts 2>&1 | tail -15`
Expected: FAIL — `selectProject` is not a function / `selectedProject` undefined.

- [ ] **Step 3: Extend the store**

In `sessionsStore.ts`: add `selectedProject: string | null` to the interface and initial state (`selectedProject: null`), add `selectProject` to the interface, and update the actions:

```ts
  select: (selectedId) => set({ selectedId, selectedProject: null }),
  selectProject: (selectedProject) => set({ selectedProject, selectedId: null }),
```

Add `selectProject: (cwd: string | null) => void;` to the `SessionsState` interface.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run src/modules/sessions/lib/sessionsStore.test.ts 2>&1 | tail -8`
Expected: PASS.

- [ ] **Step 5: Write the failing openTerminalAt test**

Create `src/modules/sessions/lib/openTerminalAt.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { openTerminalAt } from "./openTerminalAt";
import { useTabsStore } from "@/stores/tabsStore";

describe("openTerminalAt", () => {
  it("creates a terminal tab at the given cwd and returns its id", () => {
    const newTerminalTab = vi.fn().mockReturnValue("tab-9");
    vi.spyOn(useTabsStore, "getState").mockReturnValue({ newTerminalTab } as never);

    const id = openTerminalAt("/tmp/proj-a");

    expect(newTerminalTab).toHaveBeenCalledWith("/tmp/proj-a");
    expect(id).toBe("tab-9");
  });
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `pnpm vitest run src/modules/sessions/lib/openTerminalAt.test.ts 2>&1 | tail -12`
Expected: FAIL — module not found.

- [ ] **Step 7: Implement openTerminalAt**

Create `src/modules/sessions/lib/openTerminalAt.ts`:

```ts
import { useTabsStore } from "@/stores/tabsStore";

/** Opens a new terminal tab rooted at `cwd` (e.g. the project view's
 *  "open a terminal here"). Returns the created tab's id. */
export function openTerminalAt(cwd: string): string {
  return useTabsStore.getState().newTerminalTab(cwd);
}
```

- [ ] **Step 8: Run to verify it passes**

Run: `pnpm vitest run src/modules/sessions/lib/openTerminalAt.test.ts 2>&1 | tail -6`
Expected: PASS.

- [ ] **Step 9: Write the failing ProjectView test**

Create `src/modules/sessions/ProjectView.test.tsx`:

```tsx
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
        active_days: 2,
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
```

- [ ] **Step 10: Run to verify it fails**

Run: `pnpm vitest run src/modules/sessions/ProjectView.test.tsx 2>&1 | tail -12`
Expected: FAIL — module not found.

- [ ] **Step 11: Implement ProjectView**

Create `src/modules/sessions/ProjectView.tsx`. Model the tiles on `DashboardView`'s `StatCard` look (border, big value); reuse `basename` from the project path for the header. Key structure:

```tsx
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSessionsStore } from "./lib/sessionsStore";
import { sessionsProjectStats, type ProjectStats } from "./lib/projectBridge";
import { openTerminalAt } from "./lib/openTerminalAt";
import { AGENT_BADGE_CLASS } from "./lib/agentBadge";

const EMPTY: ProjectStats = {
  project_cwd: "", sessions: 0, messages: 0, output_tokens: 0, active_days: 0,
  top_model: null, first_at: 0, last_at: 0, recent: [],
};

export function ProjectView() {
  const { t } = useTranslation();
  const cwd = useSessionsStore((s) => s.selectedProject) ?? "";
  const selectProject = useSessionsStore((s) => s.selectProject);
  const select = useSessionsStore((s) => s.select);
  const [stats, setStats] = useState<ProjectStats>(EMPTY);

  useEffect(() => {
    let cancelled = false;
    if (!cwd) return;
    sessionsProjectStats(cwd).then((next) => { if (!cancelled) setStats(next); }).catch(() => {});
    return () => { cancelled = true; };
  }, [cwd]);

  const name = useMemo(() => cwd.split("/").filter(Boolean).pop() ?? cwd, [cwd]);

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => selectProject(null)}
          className="rounded px-2 py-1 text-xs text-fg-subtle hover:bg-bg-elevated hover:text-fg">
          {t("sessions.project.back")}
        </button>
        <h1 className="min-w-0 flex-1 truncate text-lg font-semibold text-fg">{name}</h1>
        <button type="button" onClick={() => openTerminalAt(cwd)}
          className="flex items-center gap-1 rounded px-2 py-1 text-xs text-fg-subtle hover:bg-bg-elevated hover:text-fg">
          {t("sessions.project.openTerminal")}
        </button>
      </div>
      <p className="mt-0.5 truncate text-xs text-fg-subtle">{cwd}</p>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Tile label={t("sessions.project.sessions")} value={stats.sessions.toLocaleString()} />
        <Tile label={t("sessions.project.messages")} value={stats.messages.toLocaleString()} />
        <Tile label={t("sessions.project.tokens")} value={stats.output_tokens.toLocaleString()} />
        <Tile label={t("sessions.project.activeDays")} value={stats.active_days.toLocaleString()} />
        <Tile label={t("sessions.project.topModel")} value={stats.top_model ?? "—"} />
      </div>

      <h2 className="mt-6 text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
        {t("sessions.project.recent")}
      </h2>
      <ul className="mt-2">
        {stats.recent.map((s) => (
          <li key={s.id}>
            <button type="button" onClick={() => select(s.id)}
              className="flex w-full min-w-0 items-center justify-between gap-2 rounded px-2 py-1.5 text-left hover:bg-bg-elevated">
              <span className="min-w-0 truncate text-sm text-fg">{s.title}</span>
              <span className={`shrink-0 text-[10px] font-medium uppercase ${AGENT_BADGE_CLASS[s.agent]}`}>
                {t(`sessions.agents.${s.agent}`)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-border bg-bg px-3.5 py-3">
      <div className="truncate text-[20px] font-bold leading-none tabular-nums text-fg">{value}</div>
      <div className="mt-1 text-[11px] text-fg-subtle">{label}</div>
    </div>
  );
}
```

- [ ] **Step 12: Run to verify it passes**

Run: `pnpm vitest run src/modules/sessions/ProjectView.test.tsx 2>&1 | tail -8`
Expected: PASS (4 tests).

- [ ] **Step 13: Route the project view in SessionsTabContent**

In `SessionsTabContent.tsx`, read `selectedProject` from the store (add to the existing `useSessionsStore` selectors) and add a branch **before** the `if (!selectedId)` at line 158:

```tsx
  if (selectedProject) {
    return <ProjectView />;
  }
  if (!selectedId) {
    return <DashboardView />;
  }
```

Import `ProjectView` at the top.

- [ ] **Step 14: Make project names clickable in the sidebar and dashboard**

In `SessionsPanel.tsx`, the row renders the project basename as text; wrap it in a click that calls `selectProject(s.project_cwd)` and `stopPropagation()` so it doesn't also select the session. In `DashboardView.tsx`'s `TopSessionRow`, make the `project_cwd` line a nested button calling `selectProject(session.project_cwd)` with `stopPropagation()`. Add `selectProject` from the store in both. (Keep the row's own click behavior intact.)

- [ ] **Step 15: Add i18n keys**

Add to both `en/common.json` and `zh-Hant/common.json` under `sessions.project`:
- en: `{ "back": "Back", "openTerminal": "Open terminal here", "sessions": "Sessions", "messages": "Messages", "tokens": "Output tokens", "activeDays": "Active days", "topModel": "Top model", "recent": "Recent sessions" }`
- zh-Hant: `{ "back": "返回", "openTerminal": "在此開新終端", "sessions": "對話數", "messages": "訊息數", "tokens": "輸出 token", "activeDays": "活躍天數", "topModel": "最常用 model", "recent": "最近對話" }`

- [ ] **Step 16: Typecheck + run sessions tests**

Run: `pnpm typecheck 2>&1 | tail -3 && pnpm vitest run src/modules/sessions 2>&1 | grep -E "Tests |×" | tail -3`
Expected: typecheck clean; all sessions tests pass.

- [ ] **Step 17: Commit**

```bash
git add src/modules/sessions/ src/i18n/locales/en/common.json src/i18n/locales/zh-Hant/common.json
git commit -m "feat(sessions): add project view screen reached by clicking a project name"
```

---

## Task 3: Session ↔ git commit correlation

**Files:**
- Modify: `src-tauri/src/modules/git/mod.rs` (add `git_commits_in_range` command + tests)
- Modify: `src-tauri/src/lib.rs` (register the command)
- Modify: `src/modules/source-control/lib/gitBridge.ts` (add `gitCommitsInRange` wrapper)
- Modify: `src/modules/sessions/SessionsTabContent.tsx` (viewer commit section)
- Modify: both locale files (`sessions.commits.*`)

**Interfaces:**
- Consumes: `run_git` (git/mod.rs:499), `parse_commit_info` (git/mod.rs:411), `CommitInfo`.
- Produces:
  - Rust command `git_commits_in_range(cwd: String, since_ms: i64, until_ms: i64) -> Result<Vec<CommitInfo>, String>` — always `Ok`, empty on any non-git/remote/failure.
  - TS `gitCommitsInRange(cwd: string, sinceMs: number, untilMs: number): Promise<CommitInfo[]>` invoking `"git_commits_in_range"` with `{ cwd, sinceMs, untilMs }`.

- [ ] **Step 1: Write the failing Rust tests**

Add to the `#[cfg(test)] mod tests` in `git/mod.rs` (create a real temp repo with two commits; use `run_git` to init/commit or `std::process::Command`). Helper sketch:

```rust
#[test]
fn commits_in_range_returns_empty_for_a_non_git_dir() {
    let dir = std::env::temp_dir().join(format!("tt-git-nonrepo-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let out = git_commits_in_range_impl(dir.to_str().unwrap(), 0, i64::MAX);
    assert!(out.is_empty());
}

#[test]
fn commits_in_range_rejects_a_remote_looking_cwd() {
    let out = git_commits_in_range_impl("ssh://host/repo", 0, i64::MAX);
    assert!(out.is_empty());
}

#[test]
fn commits_in_range_filters_by_the_time_window() {
    // Build a temp repo, commit twice with controlled author dates via
    // GIT_AUTHOR_DATE/GIT_COMMITTER_DATE (epoch seconds). One commit at t=1000s,
    // one at t=5000s. A window of [900s, 2000s] in MILLISECONDS = [900_000, 2_000_000].
    let repo = make_temp_repo_with_commits(); // helper: returns path, commits at 1000s and 5000s
    let out = git_commits_in_range_impl(&repo, 900_000, 2_000_000);
    assert_eq!(out.len(), 1, "only the t=1000s commit is inside the window");
}
```

Implementer note: factor the logic into a plain `fn git_commits_in_range_impl(cwd: &str, since_ms: i64, until_ms: i64) -> Vec<CommitInfo>` so tests call it without the Tauri command wrapper. `make_temp_repo_with_commits` uses `git init`, sets `user.email`/`user.name` locally, and commits with `GIT_AUTHOR_DATE`/`GIT_COMMITTER_DATE` set to `@1000 +0000` / `@5000 +0000`.

- [ ] **Step 2: Run to verify it fails**

Run: `cd src-tauri && cargo test git::tests::commits_in_range 2>&1 | tail -20`
Expected: FAIL — `git_commits_in_range_impl` not found.

- [ ] **Step 3: Implement the impl + command**

In `git/mod.rs`:

```rust
/// Commits authored in `[since_ms, until_ms]` (epoch MILLISECONDS) in the git
/// work tree at `cwd`. Empty for an empty/remote (`://`) `cwd`, a non-git dir,
/// or any git failure — a missing/odd repo simply shows no commits, never an
/// error. Session↔code correlation for the transcript viewer.
fn git_commits_in_range_impl(cwd: &str, since_ms: i64, until_ms: i64) -> Vec<CommitInfo> {
    if cwd.is_empty() || cwd.contains("://") || ensure_not_flag(cwd).is_err() {
        return Vec::new();
    }
    // Must be a git work tree.
    match run_git(cwd, &["rev-parse", "--is-inside-work-tree"]) {
        Ok(out) if out.trim() == "true" => {}
        _ => return Vec::new(),
    }
    // git wants seconds; sessions carry milliseconds.
    let since = (since_ms / 1000).to_string();
    let until = (until_ms / 1000).to_string();
    let args = [
        "log",
        "--date-order",
        &format!("--since={since}"),
        &format!("--until={until}"),
        "--pretty=format:%h\u{241f}%p\u{241f}%an\u{241f}%ct\u{241f}%s",
        "--max-count=100",
    ];
    match run_git(cwd, &args) {
        Ok(out) => out.lines().filter_map(parse_commit_info).collect(),
        Err(_) => Vec::new(),
    }
}

#[tauri::command]
pub fn git_commits_in_range(cwd: String, since_ms: i64, until_ms: i64) -> Result<Vec<CommitInfo>, String> {
    Ok(git_commits_in_range_impl(&cwd, since_ms, until_ms))
}
```

Note: match the exact separator byte and `parse_commit_info` signature used by the existing `log` (git/mod.rs:429-452); if `parse_commit_info` returns `Option<CommitInfo>` use `filter_map`, if `Result` adapt accordingly. Copy the `--pretty=format` string verbatim from `log`.

- [ ] **Step 4: Run to verify it passes**

Run: `cd src-tauri && cargo test git::tests::commits_in_range 2>&1 | tail -20`
Expected: PASS (3 tests).

- [ ] **Step 5: Register the command**

In `lib.rs`, add `git_commits_in_range` to the git imports and to the handler list next to `git_log`.

- [ ] **Step 6: Add the frontend bridge + failing viewer test**

In `gitBridge.ts` add:

```ts
/** Commits authored in [sinceMs, untilMs] in the git work tree at `cwd`.
 *  Empty for a non-git / remote / failed cwd. Timestamps are epoch ms. */
export function gitCommitsInRange(cwd: string, sinceMs: number, untilMs: number): Promise<CommitInfo[]> {
  return invoke<CommitInfo[]>("git_commits_in_range", { cwd, sinceMs, untilMs });
}
```

Add to `SessionsTabContent.test.tsx` a test: when `git_commits_in_range` resolves with one commit, the viewer shows its summary; when it resolves empty, no commits header appears. (Extend the existing invoke mock to answer `git_commits_in_range`.)

```tsx
it("shows a commits section listing commits made during the session", async () => {
  // arrange: select a session, make git_commits_in_range resolve to one commit
  // assert: screen.getByText("<commit summary>") present, and the header
  //         screen.getByText("sessions.commits.title") present
});

it("hides the commits section entirely when there are no commits", async () => {
  // git_commits_in_range resolves []; assert queryByText("sessions.commits.title") is null
});
```

- [ ] **Step 7: Run to verify it fails**

Run: `pnpm vitest run src/modules/sessions/SessionsTabContent.test.tsx 2>&1 | tail -12`
Expected: FAIL — commits section not rendered.

- [ ] **Step 8: Render the commit section in the viewer**

In `SessionsTabContent.tsx`, after the transcript render, add an effect that fetches commits for the selected session and a section that only renders when the list is non-empty:

```tsx
const [commits, setCommits] = useState<CommitInfo[]>([]);
useEffect(() => {
  let cancelled = false;
  if (!session) { setCommits([]); return; }
  gitCommitsInRange(session.project_cwd, session.started_at, session.ended_at)
    .then((c) => { if (!cancelled) setCommits(c); })
    .catch(() => { if (!cancelled) setCommits([]); });
  return () => { cancelled = true; };
}, [session?.id]);
```

```tsx
{commits.length > 0 && (
  <section className="mt-4 border-t border-border pt-3">
    <h2 className="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
      {t("sessions.commits.title")}
    </h2>
    <ul className="mt-2 flex flex-col gap-1">
      {commits.map((c) => (
        <li key={c.id} className="flex items-baseline gap-2 text-xs">
          <span className="shrink-0 font-mono text-fg-subtle">{c.id}</span>
          <span className="min-w-0 flex-1 truncate text-fg">{c.summary}</span>
          <span className="shrink-0 text-fg-subtle">{c.author}</span>
        </li>
      ))}
    </ul>
  </section>
)}
```

Import `gitCommitsInRange` and the `CommitInfo` type from `gitBridge`. Place the section where the viewer's scroll area holds the transcript (after the message list, inside the same scroll container).

- [ ] **Step 9: Add i18n + run to verify it passes**

Add `sessions.commits.title` — en `"Commits during this session"`, zh-Hant `"這次對話期間的 commit"`.
Run: `pnpm vitest run src/modules/sessions/SessionsTabContent.test.tsx 2>&1 | tail -8`
Expected: PASS.

- [ ] **Step 10: Typecheck + Rust build**

Run: `pnpm typecheck 2>&1 | tail -3 && cd src-tauri && cargo test git 2>&1 | grep "test result" | head -1`
Expected: clean.

- [ ] **Step 11: Commit**

```bash
git add src-tauri/src/modules/git/mod.rs src-tauri/src/lib.rs src/modules/source-control/lib/gitBridge.ts src/modules/sessions/SessionsTabContent.tsx src/modules/sessions/SessionsTabContent.test.tsx src/i18n/locales/en/common.json src/i18n/locales/zh-Hant/common.json
git commit -m "feat(sessions): correlate a session with the git commits made during it"
```

---

## Task 4: Model filter

**Files:**
- Modify: `src/modules/sessions/lib/sessionsStore.ts` (`modelFilter`/`setModelFilter`; extend `visibleSessions`)
- Modify: `src/modules/sessions/lib/sessionsStore.test.ts`
- Modify: `src/modules/sessions/SessionsPanel.tsx` (model dropdown)
- Modify: both locale files (`sessions.modelFilterAll`)

**Interfaces:**
- Consumes: `SessionSummary.model`, existing `Combobox` (`src/components/Combobox.tsx`) or the agent-chip control style.
- Produces:
  - store: `modelFilter: string` (`"all"` default), `setModelFilter(model: string)`.
  - `visibleSessions(sessions, query, agentFilter, modelFilter)` — fourth arg; `"all"` passes everything, otherwise exact `s.model === modelFilter` (a `null`-model session shows only under `"all"`).

- [ ] **Step 1: Write the failing selector test**

Add to `sessionsStore.test.ts`:

```ts
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
```

Update the existing `visibleSessions` call sites in this test file to pass `"all"` as the fourth arg.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/modules/sessions/lib/sessionsStore.test.ts 2>&1 | tail -12`
Expected: FAIL — `visibleSessions` takes 3 args / wrong result.

- [ ] **Step 3: Extend the store + selector**

In `sessionsStore.ts`: add `modelFilter: string` to the interface + initial state (`modelFilter: "all"`), add `setModelFilter: (model: string) => void;` and `setModelFilter: (modelFilter) => set({ modelFilter }),`. Extend the selector:

```ts
export function visibleSessions(
  sessions: SessionSummary[],
  query: string,
  agentFilter: SessionAgent | "all",
  modelFilter: string,
): { pinned: SessionSummary[]; history: SessionSummary[] } {
  const q = query.trim().toLowerCase();
  const filtered = sessions.filter((s) => {
    if (agentFilter !== "all" && s.agent !== agentFilter) return false;
    if (modelFilter !== "all" && s.model !== modelFilter) return false;
    if (q === "") return true;
    return s.title.toLowerCase().includes(q) || s.project_cwd.toLowerCase().includes(q);
  });
  const pinned = filtered.filter((s) => s.pinned).sort((a, b) => b.ended_at - a.ended_at);
  const history = filtered.filter((s) => !s.pinned);
  return { pinned, history };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run src/modules/sessions/lib/sessionsStore.test.ts 2>&1 | tail -8`
Expected: PASS.

- [ ] **Step 5: Wire the sidebar dropdown**

In `SessionsPanel.tsx`: read `modelFilter`/`setModelFilter` from the store and update the `visibleSessions(...)` call to pass `modelFilter`. Derive the option list from the loaded sessions:

```tsx
const modelOptions = useMemo(() => {
  const set = new Set<string>();
  for (const s of sessions) if (s.model) set.add(s.model);
  return ["all", ...[...set].sort()];
}, [sessions]);
```

Render a compact dropdown near the agent chips. Use the shared `Combobox` (`src/components/Combobox.tsx`) per the project convention, mapping `"all"` to the label `t("sessions.modelFilterAll")` and every other option to its raw model id. On change call `setModelFilter(value)`. Only render the dropdown when `modelOptions.length > 1` (i.e. at least one model exists).

- [ ] **Step 6: Add i18n + typecheck + tests**

Add `sessions.modelFilterAll` — en `"All models"`, zh-Hant `"所有 model"`.
Run: `pnpm typecheck 2>&1 | tail -3 && pnpm vitest run src/modules/sessions 2>&1 | grep -E "Tests |×" | tail -3`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/modules/sessions/ src/i18n/locales/en/common.json src/i18n/locales/zh-Hant/common.json
git commit -m "feat(sessions): add a sidebar model filter for the session list"
```

---

## Task 5: CSV export

**Files:**
- Create: `src/modules/sessions/lib/sessionsCsv.ts` + `.test.ts`
- Modify: `src/lib/dialog.ts` (optional `filters` param on `saveFile`)
- Modify: `src/modules/sessions/DashboardView.tsx` (Export CSV button)
- Modify: both locale files (`sessions.dashboard.exportCsv`)

**Interfaces:**
- Consumes: `SessionSummary`, `visibleSessions` (Task 4), `saveFile`, `fsWriteFile`.
- Produces: `toSessionsCsv(sessions: SessionSummary[]): string`.

- [ ] **Step 1: Write the failing CSV test**

Create `src/modules/sessions/lib/sessionsCsv.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { toSessionsCsv } from "./sessionsCsv";
import type { SessionSummary } from "./sessionsBridge";

const s = (o: Partial<SessionSummary>): SessionSummary => ({
  id: "id", agent: "claude", project_cwd: "/p", title: "t", started_at: 0, ended_at: 0,
  message_count: 0, user_message_count: 0, output_tokens: null, model: null,
  file_path: "/f", pinned: false, ...o,
});

describe("toSessionsCsv", () => {
  it("writes a header row plus one row per session in field order", () => {
    const csv = toSessionsCsv([s({ title: "Fix bug", agent: "codex", model: "gpt-5.5", message_count: 12 })]);
    const [header, row] = csv.split("\n");
    expect(header).toBe("title,agent,model,project,started_at,ended_at,messages,user_messages,output_tokens,pinned");
    expect(row.startsWith("Fix bug,codex,gpt-5.5,/p,")).toBe(true);
    expect(row.endsWith(",12,0,,false")).toBe(true); // null output_tokens → empty field
  });

  it("quotes and escapes fields containing commas, quotes, or newlines", () => {
    const csv = toSessionsCsv([s({ title: 'a,"b"\nc' })]);
    const row = csv.split("\n").slice(1).join("\n"); // field itself contains a newline
    expect(row.startsWith('"a,""b""\nc",claude,')).toBe(true);
  });

  it("returns just the header for an empty list", () => {
    expect(toSessionsCsv([])).toBe(
      "title,agent,model,project,started_at,ended_at,messages,user_messages,output_tokens,pinned",
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/modules/sessions/lib/sessionsCsv.test.ts 2>&1 | tail -12`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement toSessionsCsv**

Create `src/modules/sessions/lib/sessionsCsv.ts`:

```ts
import type { SessionSummary } from "./sessionsBridge";

const HEADER = [
  "title", "agent", "model", "project", "started_at", "ended_at",
  "messages", "user_messages", "output_tokens", "pinned",
] as const;

/** RFC-4180 quote: wrap in double quotes and double any inner quote when the
 *  field contains a comma, quote, CR, or LF; otherwise return it unchanged. */
function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Serializes sessions to RFC-4180 CSV: a fixed header row then one row per
 *  session. A null `output_tokens`/`model` becomes an empty field. Timestamps
 *  are the raw epoch-ms numbers (stable, spreadsheet-parseable). */
export function toSessionsCsv(sessions: SessionSummary[]): string {
  const rows = sessions.map((s) =>
    [
      s.title,
      s.agent,
      s.model ?? "",
      s.project_cwd,
      String(s.started_at),
      String(s.ended_at),
      String(s.message_count),
      String(s.user_message_count),
      s.output_tokens === null ? "" : String(s.output_tokens),
      String(s.pinned),
    ]
      .map(csvField)
      .join(","),
  );
  return [HEADER.join(","), ...rows].join("\n");
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run src/modules/sessions/lib/sessionsCsv.test.ts 2>&1 | tail -8`
Expected: PASS (3 tests).

- [ ] **Step 5: Add a `filters` param to saveFile**

In `src/lib/dialog.ts`, change `saveFile` to accept optional filters (default keeps Markdown):

```ts
export async function saveFile(
  defaultPath: string,
  filters: { name: string; extensions: string[] }[] = [{ name: "Markdown", extensions: ["md"] }],
): Promise<string | null> {
  const result = await save({ defaultPath, filters });
  return typeof result === "string" ? result : null;
}
```

(The existing Markdown export call is unchanged — it omits the second arg.)

- [ ] **Step 6: Wire the dashboard Export CSV button**

In `DashboardView.tsx`, read the loaded `sessions` and the filters (`query`, `agentFilter`, `modelFilter`) from `useSessionsStore`, and add a top-right button. Its handler:

```tsx
async function handleExportCsv() {
  const { pinned, history } = visibleSessions(sessions, query, agentFilter, modelFilter);
  const csv = toSessionsCsv([...pinned, ...history]);
  const path = await saveFile("ai-sessions.csv", [{ name: "CSV", extensions: ["csv"] }]);
  if (path === null) return;
  await fsWriteFile(path, csv);
}
```

Import `visibleSessions` from `./lib/sessionsStore`, `toSessionsCsv` from `./lib/sessionsCsv`, `saveFile` from `@/lib/dialog`, `fsWriteFile` from `@/modules/explorer/lib/fsBridge`. Place the button in the dashboard header row (next to the range chips), labelled `t("sessions.dashboard.exportCsv")`.

- [ ] **Step 7: Add a failing dashboard test for the button**

Add to `DashboardView.test.tsx` (mock `@/lib/dialog` `saveFile` → a path, and `@/modules/explorer/lib/fsBridge` `fsWriteFile`; seed the store `sessions`):

```tsx
it("exports the filtered session list as CSV via saveFile + fsWriteFile", async () => {
  // seed useSessionsStore.setState({ sessions: [oneSession], query:"", agentFilter:"all", modelFilter:"all" })
  // render, click getByRole("button", { name: "sessions.dashboard.exportCsv" })
  // await: expect(mockSaveFile).toHaveBeenCalledWith("ai-sessions.csv", [{ name: "CSV", extensions: ["csv"] }])
  // expect(mockFsWriteFile).toHaveBeenCalledWith("/path.csv", expect.stringContaining("title,agent,model"))
});
```

- [ ] **Step 8: Run to verify the whole task passes**

Run: `pnpm vitest run src/modules/sessions/DashboardView.test.tsx src/modules/sessions/lib/sessionsCsv.test.ts 2>&1 | grep -E "Tests |×" | tail -3`
Expected: PASS.

- [ ] **Step 9: Add i18n + typecheck**

Add `sessions.dashboard.exportCsv` — en `"Export CSV"`, zh-Hant `"匯出 CSV"`.
Run: `pnpm typecheck 2>&1 | tail -3`
Expected: clean.

- [ ] **Step 10: Commit**

```bash
git add src/modules/sessions/ src/lib/dialog.ts src/i18n/locales/en/common.json src/i18n/locales/zh-Hant/common.json
git commit -m "feat(sessions): export the filtered session list as CSV from the dashboard"
```

---

## Task 6: Verification + PR

**Files:** none (verification + PR only)

- [ ] **Step 1: Full frontend suite + typecheck**

Run: `pnpm typecheck 2>&1 | tail -3 && pnpm test 2>&1 | grep -E "Tests " | tail -1`
Expected: typecheck clean; all frontend tests pass.

- [ ] **Step 2: Full Rust suite**

Run: `cd src-tauri && cargo test 2>&1 | grep "test result" | tail -5`
Expected: all suites pass (sessions_index + git).

- [ ] **Step 3: Build + relaunch for manual check**

Run:
```bash
export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/tempo-term.key)" TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
pnpm tauri build 2>&1 | grep -E "Finished 1 updater|error running bundle" | tail -1
pkill -f "TempoTerm.app/Contents/MacOS/tempo-term" 2>/dev/null; sleep 1
rm -rf ~/Library/Caches/com.tempoterm.desktop ~/Library/WebKit/com.tempoterm.desktop 2>/dev/null
nohup ./src-tauri/target/release/bundle/macos/TempoTerm.app/Contents/MacOS/tempo-term >/tmp/app-p3.log 2>&1 &
```
Manual: click a project name → project view; open terminal here; a session with local git commits shows the commits section; model filter narrows the list; Export CSV writes a file.

- [ ] **Step 4: Final whole-branch review**

Dispatch a `code-reviewer` on the diff `git merge-base origin/master HEAD..HEAD`. Fix Critical/Important findings.

- [ ] **Step 5: Push + open PR**

```bash
git push -u origin feat/ai-sessions-p3
MILESTONE=$(gh api repos/mukiwu/tempo-term/milestones --jq '.[0].title')
gh pr create --title "feat: AI sessions view (P3) — project view, git correlation, model filter, CSV" --body "<summary + test plan>"
PR=$(gh pr view --json number --jq .number)
gh pr edit "$PR" --add-label enhancement --milestone "$MILESTONE" --add-assignee mukiwu
```

- [ ] **Step 6: Track Gemini review**

After the PR opens, fetch `gh api repos/mukiwu/tempo-term/pulls/$PR/reviews` and `.../comments`; triage high/medium/low; fix or reply in English.

---

## Self-Review

**Spec coverage:** Project view (T1 backend + T2 frontend), git correlation (T3), model filter (T4), CSV export (T5), verification/PR (T6) — every spec section maps to a task. Non-goals (FTS, remote git, commit→graph jump, per-project charts) are correctly absent.

**Placeholder scan:** `list_for_project` (T1 Step 3) intentionally defers to `list()`'s exact SELECT/mapping with an explicit implementer note (the real column list lives in index.rs:140 and must be copied verbatim, not invented) — this is a "copy the existing pattern" instruction, not a vague placeholder. The T3 repo-fixture helper and two component-test bodies (T3 Step 6, T5 Step 7) are described by their asserts rather than fully written; every other step carries complete code.

**Type consistency:** `ProjectStats` fields match between Rust (T1 Step 3), the command (T1 Step 5), and TS (T1 Step 7). `visibleSessions` gains a 4th `modelFilter` arg consistently across T4 (definition) and T5 (call site). `selectProject`/`select` mutual-clear defined in T2 and relied on in T2's routing. `gitCommitsInRange(cwd, sinceMs, untilMs)` matches the Rust `git_commits_in_range(cwd, since_ms, until_ms)`.
