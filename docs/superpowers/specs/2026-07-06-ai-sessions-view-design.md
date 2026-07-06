# AI sessions view (AgentsView-style session browser) (v1)

Status: approved design, ready for planning
Date: 2026-07-06
Branch: feat/ai-sessions-view

## Problem

tempo-term already tracks *live* AI CLI activity: `claude_progress` /
`codex_progress` tail the newest JSONL from end-of-file and stream appends,
and OSC 6973 status hooks drive per-pane badges. But there is no way to
browse, search, or manage *historical* sessions, and no aggregate view of
AI usage across agents and projects.

AgentsView (`kenn-io/agentsview`, Go, MIT, ~3.9k stars) solves this as a
standalone app: it indexes session logs from many agents into SQLite and
serves a dashboard (stat cards, activity heatmap, top sessions) plus a
session browser. The user wants that experience inside tempo-term — a
sidebar session list plus a main-area dashboard/viewer — covering the three
agents used on this machine: Claude Code, Codex, and Antigravity CLI.

Antigravity feasibility was verified: the local install is Antigravity CLI
(not the IDE), and its sessions are per-conversation SQLite trajectory
databases that agentsview reads directly without decryption. Feasible.

## Goals

- Sidebar "AI Sessions" view: session list for Claude / Codex / Antigravity
  with search, agent filter, pinned group, and a Live section at top bound
  to running terminal panes.
- Main-area "Sessions" content tab with three internal screens:
  dashboard (default), session transcript viewer, project view.
- Dashboard: stat cards, calendar activity heatmap, Top Sessions
  (must-have), date range filter, weekly digest card.
- Management: resume in a new terminal tab, pin, delete (to system trash via
  the `trash` crate already in Cargo.toml), export to Markdown.
- Differentiators over AgentsView (it is an offline viewer; tempo-term is
  where sessions actually happen): Live section that jumps to the running
  tab, project view with one-click "new tab at this cwd", session ↔ git
  commit correlation, weekly digest.
- Hard constraint: keep the app lightweight. No new npm packages (charts
  are hand-rolled CSS/SVG). Only new Rust crate is `rusqlite` — linked
  against the system SQLite on macOS, `bundled` only on Windows (~+1 MB).
  Protobuf is hand-decoded (no prost). Trash reuses the `trash` crate the
  file explorer already depends on. Watching reuses existing `notify`.

## Non-goals (v1)

- Antigravity IDE format (`~/.gemini/antigravity/`) — not installed here;
  the parser registry keeps a slot for it.
- Full-text search over message content (needs FTS5 or stored bodies) — P3.
- AgentsView's sync/import/publish/MCP features (multi-machine sync,
  session publishing, chat import). Out of scope entirely.
- Modifying live-tracking modules (`claude_progress`, `codex_progress`,
  status hooks). The new module is read-only alongside them.

## Data sources (verified on this machine, 2026-07-06)

| Agent | Location | Format |
|---|---|---|
| Claude Code | `~/.claude/projects/<mangled-cwd>/*.jsonl` (top level only; `<session-id>/subagents/` and `tool-results/` are companions, not sessions) | JSONL; entries form a DAG via `uuid`/`parentUuid`; `message.usage` carries token counts |
| Codex | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` and `~/.codex/archived_sessions/*.jsonl` | JSONL event stream: `session_meta` (id, cwd, source), `event_msg` (`user_message`, `task_started`, …), `response_item` (role + content), `turn_context` |
| Antigravity CLI | `~/.gemini/antigravity-cli/conversations/<uuid>.db` | SQLite, open read-only (`mode=ro`; WAL/SHM handled by SQLite). `steps` table: `idx`, `step_type` (14 = user, 15 = assistant), `step_payload` protobuf (field 5 timestamp, field 17 text). `gen_metadata` table: per-step protobuf with model name and input/output/reasoning tokens |

Existing env overrides are honored: `CLAUDE_CONFIG_DIR` (see
`claude_progress::config_base_dir`) and `CODEX_HOME`; add
`ANTIGRAVITY_CLI_DIR` equivalent.

Parsing rules ported from agentsview (logic reference, MIT):

- **Claude**: walk the DAG main path (at forks, follow last child when the
  abandoned branch has ≤ 3 user turns — retry gap — else first child);
  skip `isMeta` entries, command envelopes, and empty messages; title from
  `displayName` or first real user message (reuse
  `claude_progress::extract_session_title`); tokens from `message.usage`
  (context = `input_tokens` + `cache_creation_input_tokens` +
  `cache_read_input_tokens`; output = `output_tokens`); duration from
  first/last timestamps across all lines.
- **Codex**: session id + cwd from `session_meta`; title = first
  `user_message` event (reuse `codex_progress::extract_codex_title`);
  count `response_item` messages with role user/assistant, skip
  `developer` role and replayed instructions; token usage from token-count
  events where present (exact shape verified during implementation).
- **Antigravity**: messages from `steps` as above; model + tokens from
  `gen_metadata` joined on `idx`; title = first user step (check
  `conversation_summaries.db` as a richer title source during
  implementation).

## Architecture

New Rust module `src-tauri/src/modules/sessions_index/`:

```
scanner.rs      enumerate session files across the three roots
claude.rs       parser → SessionMeta (+ full transcript on demand)
codex.rs        parser → SessionMeta (+ full transcript on demand)
antigravity.rs  parser → SessionMeta (+ full transcript on demand)
index.rs        SQLite index: schema, upserts, queries, stats
watch.rs        notify watchers (500 ms debounce) → incremental sync
mod.rs          Tauri commands + state
```

**Index stores metadata and aggregates only — never message bodies.**
Clicking a session re-parses its source file on demand, so the viewer is
always fresh and the index stays a few MB. The DB is a disposable cache in
the app data dir; schema version bump or corruption → delete and rebuild.
Source files remain the single source of truth.

Schema sketch:

```sql
sessions(id PK, agent, project_cwd, title, started_at, ended_at,
         message_count, user_message_count, output_tokens,
         context_peak_tokens, model, file_path, file_mtime, file_size,
         file_offset, pinned, updated_at)
daily_stats(agent, project_cwd, date, hour,
            messages, user_messages, sessions_started, output_tokens,
            PRIMARY KEY(agent, project_cwd, date, hour))
meta(key PK, value)   -- schema_version, last_full_scan
```

Incremental sync (v1): per-file `mtime`/`size` skip-cache; a changed file is
re-parsed whole (per-file cost, on a background thread), unchanged files are
skipped entirely. Byte-offset tail parsing is a later optimization if
profiling demands it — Claude's DAG main-path selection makes append-only
counting fragile, so whole-file re-parse is the simpler correct baseline.
Antigravity uses a composite fingerprint (db + `-wal` + `-shm` mtime/size).
Per-day activity rows are keyed by session id and replaced together with
their session row, so a re-parse never double-counts. Initial full index runs
on a background thread at first watch, never blocking the UI. After each
sync batch the backend emits `sessions-index:updated`; the frontend
re-queries lazily only while the view is visible.

## IPC surface

```
sessions_list(filter)       → Vec<SessionSummary>
                              filter: agent?, project?, query? (title/project match),
                              date_range?, pinned_only?
sessions_get(id)            → SessionTranscript (on-demand parse of source file)
sessions_stats(range)       → { cards, heatmap_buckets, top_sessions, weekly_digest }
sessions_pin(id, pinned)    → ()
sessions_delete(id)         → ()   move to system trash (osascript / PowerShell),
                              including companions (Claude: <id>/ dir;
                              Antigravity: -wal/-shm); frontend shows ConfirmDialog first
sessions_export(id)         → String (Markdown); frontend saves via existing save-dialog path
sessions_git_commits(id)    → Vec<CommitInfo>  git log in project_cwd
                              between started_at and ended_at
```

Event: `sessions-index:updated { agent, dirty_count }`.

Resume is frontend-only: open a new terminal tab at the session's cwd and
run `claude --resume <id>` / `codex resume <id>` (exact Codex syntax
verified during implementation). Antigravity resume support is unverified;
its resume button stays hidden until confirmed.

Live section bypasses the index entirely: it reads the existing
`sessionStatusStore` / `progressStore` / title stores and uses `tabsStore`
to focus the pane.

## Frontend

New module `src/modules/sessions/` (component + `lib/` store + invoke
bridge), registered via the standard 4-step recipe: `SidebarView` union in
`uiStore.ts`, `SIDEBAR_TABS` entry in `Sidebar.tsx`, conditional render,
`nav.*` labels in en + zh-Hant. The next ⌥N shortcut comes free from
`SIDEBAR_VIEW_ORDER`.

Sidebar panel, top to bottom:

1. **Live** — running sessions with status badge; click focuses the tab.
2. Search box + agent filter chips (Claude / Codex / Antigravity).
3. **Pinned** group.
4. History list, newest first, with a project-grouping toggle. Row =
   title, project basename, agent badge, relative time, message count.

Main area: one "Sessions" content tab with internal routing
(`dashboard` | `session/<id>` | `project/<cwd>`), never multiple tabs.
The editor already proves non-terminal main-area content; the exact tab
mechanism is verified at planning time.

- **Dashboard** (default): stat cards (Sessions, Messages, Projects,
  Active Days, Messages/Session), calendar heatmap (CSS grid, messages
  metric in v1), Top Sessions by messages / output tokens, date range
  filter, weekly digest card (per-agent sessions, messages, tokens, rough
  cost from a small built-in pricing map, active hours).
- **Session viewer**: transcript grouped by role, tool calls collapsed by
  default, "commits during this session" section, action bar
  (resume / pin / delete / export). Back returns to dashboard.
- **Project view**: per-cwd aggregates, recent sessions, "open terminal
  here" button.

All charts hand-rolled (CSS grid heatmap, div bars). No chart library.

## Error handling

All three formats are unofficial internals — parse defensively: skip
malformed lines and undecodable protobuf fields, treat missing dirs as
empty, retry a locked Antigravity DB on the next sync round, clamp absurd
token values. A parse failure of one file never aborts a sync batch.
Everything is local; no network access.

## Testing

TDD throughout. Rust: fixture-based parser tests per agent (scrubbed
real samples), incremental-sync tests (append / new file / rotation /
reset), daily-stats aggregation tests, index rebuild test. Frontend:
store/normalizer unit tests (vitest) and cheap component smoke tests.

## Phasing (one PR each)

| Phase | Scope |
|---|---|
| P1 | sessions_index module (3 parsers, SQLite index, watcher, incremental sync); sidebar view (Live, search, filter, pins, history list); session viewer; resume |
| P2 | dashboard (stat cards, calendar heatmap, Top Sessions, date range), weekly digest card; delete to trash; export Markdown |
| P3 | project view; git commit correlation; day/hour distribution; model filter; CSV export; FTS full-text search |

## Open questions (resolve during planning/implementation)

- Exact `codex resume` CLI syntax and whether Antigravity CLI has resume.
- Codex token-count event shape in rollout files.
- Whether `conversation_summaries.db` yields better Antigravity titles.
- Main-area content-tab mechanism (editor precedent) details.
