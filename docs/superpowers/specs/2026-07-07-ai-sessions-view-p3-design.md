# AI sessions view P3 (project view, git correlation, model filter, CSV) (v1)

Status: approved design, ready for planning
Date: 2026-07-07
Branch: feat/ai-sessions-p3 (based on master c08c9df — P1 #147 + P2 #148 both merged)

## Problem

The AI Sessions view (P1 browse, P2 dashboard/delete/export) has no way to look
at one project's history, no link between a conversation and the code it
produced, no way to narrow the list by model, and no spreadsheet-friendly
export. P3 adds those, all reusing existing patterns. Full-text search over
message content is explicitly out of scope (a later phase).

## Goals

- **Project view**: a third main-area screen showing one project's aggregate
  stats and recent sessions, reached by clicking a project name, with a
  one-click "open a terminal here".
- **Session ↔ git commit correlation**: in the transcript viewer, a section
  listing the local git commits made in that project during the session's time
  window. Absent (whole section hidden) for non-git / remote / no-commit cases.
- **Model filter**: a sidebar dropdown that narrows the session list to one
  model, alongside the existing agent chips.
- **CSV export**: a dashboard button that exports the currently-filtered
  session list as CSV.

## Non-goals (v1)

- Full-text search over message bodies (needs FTS5 / stored bodies — deferred).
- Git correlation for remote (SSH) or non-git working directories — those hide
  the section rather than erroring.
- Clicking a commit to jump into the git-graph view (P3 shows commits read-only;
  a jump is a later nicety).
- Per-project heatmap / charts in the project view (v1 is stat tiles + a
  recent-sessions list; charts can follow).

## Verified facts (recon, in the dev worktree)

- **git module** `src-tauri/src/modules/git/mod.rs`: `CommitInfo` (mod.rs:23-31)
  = `{ id (short hash), summary, author, timestamp: i64, parents: Vec<String> }`.
  ⚠️ `timestamp` is epoch **seconds** (`%ct`), but sessions' `started_at`/
  `ended_at` are epoch **milliseconds** — convert (ms/1000) before passing to
  git or comparing. `run_git(repo_path, args)` (mod.rs:46-ish / 499) is the
  `git -C <repo_path> …` primitive; `parse_commit_info` (mod.rs:411) parses the
  `%h␟%p␟%an␟%ct␟%s` line format; `ensure_not_flag` (mod.rs:527) guards
  positional args. **No** `--since/--until` support exists — a new command adds
  it. Frontend git bridge: `src/modules/source-control/lib/gitBridge.ts`.
- **sessions_index** `src-tauri/src/modules/sessions_index/`: schema
  `sessions(id, agent, project_cwd, title, started_at, ended_at, message_count,
  user_message_count, output_tokens, model, file_path, …)` (index.rs:51-75) +
  `activity(session_id, date, hour, messages, user_messages, output_tokens)`.
  Commands registered in `lib.rs`. `SessionSummary` types.rs:36-49 /
  `sessionsBridge.ts:13-26` — `model` is already present (`Option<String>` /
  `string | null`).
- **Sessions tab routing** `SessionsTabContent.tsx:158-160`: two screens keyed
  off store `selectedId` (`null` → `DashboardView`, set → transcript viewer).
  Single `"sessions"` TabKind; no new kind needed for a third screen.
- **sessions store** `sessionsStore.ts`: `{ sessions, loaded, query, agentFilter,
  selectedId }` + `visibleSessions(sessions, query, agentFilter)` selector
  (:84, predicate :91). Model list must be derived client-side from
  `sessions[].model` (no backend distinct-models query; `range_models` drops
  null-model sessions so it's not a clean filter source).
- **Export/save** `saveFile(defaultPath)` (`src/lib/dialog.ts:18`) currently
  hardcodes a Markdown filter; CSV needs a filter param or a sibling helper.
  `fsWriteFile(path, contents)` (`src/modules/explorer/lib/fsBridge.ts:42`).
- **Open terminal at cwd**: `useTabsStore.getState().newTerminalTab(cwd)`
  (tabsStore.ts:436) returns a tabId; to also run a command, mirror
  `resumeSession` (`resume.ts:49-61`): create tab, read back `activeLeafId`,
  `writeToTerminal(leafId, cmd + "\n")` (`terminalBus.ts`).

## Architecture

### A. Project view (Task 1 backend, Task 2 frontend)

**Backend** — new command `sessions_project_stats(project_cwd: String) ->
ProjectStats` on the index (mirrors `sessions_stats`'s async + spawn_blocking
shape; empty/unknown project ⇒ zeroed stats, never Err):

```rust
#[derive(Debug, Clone, serde::Serialize)]
pub struct ProjectStats {
    pub project_cwd: String,
    pub sessions: i64,
    pub messages: i64,
    pub output_tokens: i64,
    pub active_days: i64,
    /// Most-used model (by session count) in this project, or None.
    pub top_model: Option<String>,
    pub first_at: i64,   // earliest started_at (ms), 0 when none
    pub last_at: i64,    // latest ended_at (ms), 0 when none
    /// The project's own sessions, newest first (reuses SessionSummary).
    pub recent: Vec<SessionSummary>,
}
```

Aggregates are `SUM`/`COUNT` over `sessions`/`activity` filtered to
`project_cwd = ?1`. `recent` is `SELECT … WHERE project_cwd=?1 ORDER BY
ended_at DESC LIMIT 50`.

**Frontend** — a third screen. Add `selectedProject: string | null` +
`selectProject(cwd | null)` to `sessionsStore`. `SessionsTabContent` routing
gains a branch **above** the existing two: `selectedProject` set → render
`ProjectView`; else the current `selectedId` split. Selecting a session or the
dashboard clears `selectedProject`; opening the project view clears
`selectedId`. Project names become clickable (`selectProject(cwd)`) in: sidebar
rows (the project basename), the dashboard's Top Sessions rows, and the
transcript viewer's header path. `ProjectView` fetches
`sessionsProjectStats(cwd)` on mount, renders stat tiles (sessions / messages /
output tokens / active days / top model) + a "back" button + an "open terminal
here" button (`newTerminalTab(cwd)`) + a recent-sessions list (row click →
`select(id)` into the viewer).

### B. Git commit correlation (Task 3)

**Backend** — new command `sessions_git_commits(cwd: String, since_ms: i64,
until_ms: i64) -> Vec<CommitInfo>`:
- Return `[]` immediately if `cwd` is empty, looks remote (`parseRemoteUri`
  concerns are frontend; backend: reject a `cwd` containing `://`), or isn't a
  git work tree (`git -C <cwd> rev-parse --is-inside-work-tree` fails/≠ "true").
- Else run `git -C <cwd> log --since=<since_s> --until=<until_s>
  --pretty=format:%h␟%p␟%an␟%ct␟%s --max-count=100` (convert ms→seconds for the
  date bounds), parse each line with `parse_commit_info`. Any git failure ⇒
  `[]` (never an error — a missing/odd repo just shows no commits).
- Guard `cwd` with the existing arg-safety approach; the since/until values are
  numeric strings we format ourselves, not user input.

**Frontend** — in the transcript viewer, after the transcript, a "commits
during this session" section: call `sessionsGitCommits(session.project_cwd,
session.started_at, session.ended_at)` in an effect (cancel stale like the
transcript fetch). Render nothing (no header, no empty state) when the result
is empty — the whole block only appears when there are commits. Each row: short
hash (mono), subject (truncate), author + relative date.

### C. Model filter (Task 4)

Add `modelFilter: string | "all"` + `setModelFilter` to `sessionsStore`, and
extend `visibleSessions` to a fourth argument, filtering `s.model === modelFilter`
(exact match; `"all"` passes everything; a session with `model === null` only
shows under `"all"`). The sidebar (`SessionsPanel`) renders a compact model
dropdown (a `<Combobox>` per the project's dropdown convention, or a native-free
control matching the agent chips) whose options are the distinct non-null
`sessions[].model` values (sorted) plus "all". Deriving the list client-side
means no backend change.

### D. CSV export (Task 5)

Pure frontend. A `toSessionsCsv(sessions: SessionSummary[]): string` helper
(unit-tested) builds RFC-4180 CSV: header row `title,agent,model,project,
started_at,ended_at,messages,user_messages,output_tokens,pinned` then one row
per session, with proper quoting (wrap fields containing `,` `"` or newlines in
double quotes, escape `"`→`""`), timestamps as ISO-8601 local. A dashboard
top-right "Export CSV" button exports the **currently filtered** list
(`visibleSessions(...)` flattened: pinned + history) via a `saveFile` variant
that offers a `.csv` filter, then `fsWriteFile`. `saveFile` gains an optional
`filters` param (default keeps today's Markdown behavior) so both exporters
share it.

## Error handling

Everything degrades quietly: project stats on an unknown cwd → zeros; git
commits on a non-repo/remote/failed cwd → empty (section hidden); CSV of an
empty list → header-only file; a cancelled save dialog → no-op. Git is read-only
(`log`/`rev-parse`); no writes to the repo. All new IPC follows the module's
existing async + spawn_blocking + defensive-parse conventions.

## Testing (TDD)

- Rust: `sessions_project_stats` aggregation (fixture with 2 projects — counts,
  top_model, first/last, recent ordering, empty project → zeros);
  `sessions_git_commits` — a real temp git repo with commits inside/outside the
  window (since/until filtering, ms→s conversion), a non-git dir → `[]`, a
  `cwd` with `://` → `[]`.
- Frontend: `visibleSessions` model-filter cases (exact match, "all", null
  model); `toSessionsCsv` (quoting, escaping, empty list, field order);
  component tests — project name click routes to ProjectView; ProjectView renders
  tiles + recent list + fires open-terminal; the viewer's commit section renders
  on non-empty and is absent on empty; the CSV button calls saveFile + fsWriteFile
  with the filtered rows.

## Phasing (one PR)

| Task | Scope |
|---|---|
| T1 | `sessions_project_stats` command + ProjectStats type + Rust tests |
| T2 | ProjectView screen + store `selectedProject`/`selectProject` + routing + clickable project names + open-terminal |
| T3 | `sessions_git_commits` command (+ tests) + viewer commit section |
| T4 | model filter (store + visibleSessions + sidebar dropdown) |
| T5 | CSV export (`toSessionsCsv` + `saveFile` filter param + dashboard button) |
| T6 | verification + PR |

## Dependency budget

Zero new npm packages, zero new Rust crates. Git reuses the existing module;
CSV is hand-built; the project view and model filter are hand-rolled UI over
existing stores.

## Open questions (resolved)

- Project view entry: click a project name (not a separate projects list). ✓
- Git correlation scope: local git only; non-git/remote/no-commit → hide the
  section. ✓
- Model filter home: sidebar, beside the agent chips. ✓
- CSV content: the currently-filtered session list. ✓
