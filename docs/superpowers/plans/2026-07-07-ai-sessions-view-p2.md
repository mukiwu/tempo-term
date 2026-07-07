# AI Sessions View P2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dashboard (stat cards, calendar heatmap, Top Sessions, date filter, weekly digest) as the Sessions tab's default screen, plus delete-to-trash and Markdown export.

**Architecture:** New `sessions_stats` / `sessions_delete` / `sessions_export` Tauri commands over the existing P1 index (SQL aggregation over the `sessions` + `activity` tables). The Sessions content tab gains internal routing: `selectedId === null` shows the dashboard (replacing the P1 empty state), a selected session shows the viewer with a back button. All charts hand-rolled (CSS grid heatmap, div bars) — no chart library.

**Tech Stack:** rusqlite aggregation, React 19 + zustand + Tailwind v4, `trash` crate (already a dependency), `@tauri-apps/plugin-dialog` save dialog.

**Spec:** `docs/superpowers/specs/2026-07-06-ai-sessions-view-design.md` (P2 row)

## Global Constraints

- **No new npm dependencies, no new Rust crates.** Charts are hand-rolled; trash uses the existing `trash` crate (see `fs/ops.rs:30` for the pattern); save dialog uses the already-installed `@tauri-apps/plugin-dialog`.
- All user-visible strings through i18next in **both** en and zh-Hant.
- English comments/commits, conventional commits, no AI attribution.
- Delete NEVER permanently removes: always `trash::delete` (recoverable), always behind the in-app `ConfirmDialog` (`src/components/ConfirmDialog.tsx`) — never `window.confirm`.
- Defensive everywhere: a stats query on an empty index returns zeros, never errors.
- Branch: `feat/ai-sessions-dashboard` (based on squash-merged master 7035ce6), worktree `/Users/muki/Documents/01.project/tempo-term-dev`.
- Test commands: `cd src-tauri && cargo test sessions_index`; `pnpm test src/modules/sessions`; `pnpm typecheck`.

## Verified facts

- Index schema (index.rs): `sessions(id, agent, project_cwd, title, started_at, ended_at, message_count, user_message_count, output_tokens, model, file_path, file_mtime, file_size)`, `activity(session_id, date TEXT "YYYY-MM-DD", hour, messages, user_messages, output_tokens)`, `pins(session_id)`. All timestamps epoch ms; activity dates are LOCAL calendar dates.
- `Index` struct exposes `conn` as `pub(crate)` field within the module (tests use it); add new query methods on `impl Index`.
- Commands registered in `src-tauri/src/lib.rs` `generate_handler![...]` (~line 142 cluster) — add the three new names beside sessions_list etc.
- Frontend: `SessionsTabContent.tsx` currently renders empty-state when `selectedId === null`; `useSessionsStore.select(id|null)` drives it. `sessionsBridge.ts` is the invoke wrapper home. Event `sessions-index:updated` triggers panel refresh already.
- Companion files to trash with a session: claude → the sibling dir named `<file stem>` (contains subagents/, tool-results/) if it exists; antigravity → `<db>-wal` and `<db>-shm` if they exist; codex → none.
- `trash::delete(path)` pattern: `src-tauri/src/modules/fs/ops.rs:30`.
- Save dialog: `@tauri-apps/plugin-dialog` exports `save({ defaultPath, filters })` → `string | null`; write via existing `fsWriteFile` (`src/modules/explorer/lib/fsBridge.ts`).
- Weekly cost: only OUTPUT tokens exist in the index (P1 never stored input tokens). The digest shows per-agent totals plus a rough output-token cost from a small built-in per-model price map — clearly labelled as an estimate ("≈").

## File Structure

```
src-tauri/src/modules/sessions_index/
  stats.rs        NEW: aggregation queries + SessionsStats types
  export.rs       NEW: transcript → Markdown string
  index.rs        MODIFY: delete_session(id) removing rows
  mod.rs          MODIFY: 3 new commands (sessions_stats, sessions_delete, sessions_export)

src/modules/sessions/
  DashboardView.tsx        NEW: cards + heatmap + top sessions + digest + range filter
  lib/statsBridge.ts       NEW: sessionsStats/sessionsDelete/sessionsExport wrappers + types
  lib/cost.ts (+test)      NEW: rough output-token cost estimator (per-model price map)
  SessionsTabContent.tsx   MODIFY: internal routing (dashboard ↔ viewer + back button), delete/export actions
  SessionsPanel.tsx        MODIFY: row delete on hover (with ConfirmDialog), "open dashboard" affordance

Modified: src-tauri/src/lib.rs, src/i18n/locales/{en,zh-Hant}/common.json
```

---

### Task 1: Stats aggregation (Rust)

**Files:**
- Create: `src-tauri/src/modules/sessions_index/stats.rs`
- Modify: `src-tauri/src/modules/sessions_index/mod.rs` (module decl + command), `src-tauri/src/lib.rs` (register)

**Interfaces (produces — frontend contract):**

```rust
#[derive(Debug, Clone, serde::Serialize)]
pub struct SessionsStats {
    pub cards: StatsCards,
    pub heatmap: Vec<HeatmapDay>,          // one entry per date with activity, ascending
    pub top_by_messages: Vec<TopSession>,  // up to 10
    pub top_by_tokens: Vec<TopSession>,    // up to 10, sessions with tokens only
    pub weekly: Vec<WeeklyAgentRow>,       // last 7 LOCAL days, one row per agent seen
}
#[derive(Debug, Clone, serde::Serialize)]
pub struct StatsCards {
    pub sessions: i64,
    pub messages: i64,
    pub user_messages: i64,
    pub projects: i64,        // distinct non-empty project_cwd
    pub active_days: i64,     // distinct activity dates
    pub messages_per_session: f64, // 0.0 when sessions == 0
}
#[derive(Debug, Clone, serde::Serialize)]
pub struct HeatmapDay { pub date: String, pub messages: i64 }
#[derive(Debug, Clone, serde::Serialize)]
pub struct TopSession { pub id: String, pub agent: String, pub title: String, pub project_cwd: String, pub value: i64 }
#[derive(Debug, Clone, serde::Serialize)]
pub struct WeeklyAgentRow { pub agent: String, pub sessions: i64, pub messages: i64, pub output_tokens: i64, pub models: Vec<ModelTokens> }
#[derive(Debug, Clone, serde::Serialize)]
pub struct ModelTokens { pub model: String, pub output_tokens: i64 }

impl Index {
    /// All aggregates for sessions whose activity falls in the last `days`
    /// local days (None = all time). Empty index ⇒ zeroed stats, never Err.
    pub fn stats(&self, days: Option<i64>) -> SessionsStats;
}

#[tauri::command]  // async + spawn_blocking like sessions_list
pub async fn sessions_stats(state: State<'_, SessionsIndexState>, days: Option<i64>) -> Result<SessionsStats, String>;
```

**Implementation notes:**
- Date-range filter: compute the cutoff LOCAL date string (`chrono::Local::now() - Duration::days(days)` → `YYYY-MM-DD`) and filter `activity.date >= cutoff`; card "sessions" = sessions whose `ended_at` ms ≥ cutoff midnight (approximate by joining sessions on ids present in filtered activity — simpler and consistent: `sessions` = `COUNT(DISTINCT activity.session_id)` in range; messages/user_messages/tokens = SUM over filtered activity; projects = COUNT(DISTINCT project_cwd) join sessions; active_days = COUNT(DISTINCT date)).
- Top sessions: `SELECT ... FROM sessions ORDER BY message_count DESC LIMIT 10` (and `output_tokens DESC ... WHERE output_tokens IS NOT NULL`), filtered to ids active in range when a range is set (JOIN on the filtered activity ids).
- Weekly: fixed last-7-local-days window independent of the `days` filter; per-agent aggregation, plus per-model output tokens (`GROUP BY agent, model`, model NULL → skip from models vec but keep in totals).
- All zero-row cases produce zeroed structs (`messages_per_session = 0.0`).

- [ ] **Step 1: Write failing tests** in `stats.rs` `#[cfg(test)]`: seed a temp Index with `upsert_session` fixtures (reuse Task-2-style `sample()` builders — 3 sessions across 2 agents/2 projects, activity on distinct dates incl. one older than 30 days, one session with tokens+model). Assert: all-time cards (counts, projects=2, active_days, mps), 30-day filter excludes the old session's activity, heatmap ascending dates, top-by-messages ordering, top-by-tokens excludes token-less sessions, weekly window only counts last-7-day rows, empty index ⇒ zeroed stats.
- [ ] **Step 2: RED** — `cargo test sessions_index::stats` fails to compile.
- [ ] **Step 3: Implement** stats.rs + command + registration.
- [ ] **Step 4: GREEN** — `cargo test sessions_index && cargo check` all green.
- [ ] **Step 5: Commit** `feat(sessions): stats aggregation command for the dashboard`

---

### Task 2: Dashboard UI + internal routing

**Files:**
- Create: `src/modules/sessions/lib/statsBridge.ts` (types mirroring Task 1 serde snake_case + `sessionsStats(days?: number)` wrapper)
- Create: `src/modules/sessions/DashboardView.tsx`
- Modify: `src/modules/sessions/SessionsTabContent.tsx`, both locale files

**Interfaces:**
- `SessionsTabContent`: `selectedId === null` → `<DashboardView />` (replaces the empty state); selected → existing viewer with a back button (`select(null)`) in the header.
- `DashboardView` fetches `sessionsStats(days)` on mount and on `sessions-index:updated` (reuse `onSessionsUpdated`); range filter state local to the component: `30 | 90 | 365 | null` (default 365), rendered as chips like the panel's agent filter.
- Layout: stat card row (Sessions / Messages / Projects / Active days / Msgs per session) → calendar heatmap → two-column: Top Sessions (tab toggle by messages/tokens; row click = `select(id)`) and Weekly digest card (Task 3 fills the digest; this task renders per-agent sessions/messages/tokens rows).
- Heatmap: GitHub-style CSS grid — columns = weeks (up to 53), rows = 7 days; intensity buckets 0/1-3/4-9/10-24/25+ mapped to `bg-bg-elevated`, `bg-accent/25`, `/45`, `/70`, `bg-accent`; tooltip via `title` attribute (`date · N messages`). Pure function `heatmapWeeks(days: HeatmapDay[], end: Date): (HeatmapDay | null)[][]` in `DashboardView.tsx` or a small lib file — unit-tested.
- i18n keys (both locales): `sessions.dashboard.{title,range30,range90,range365,rangeAll,cards.sessions,cards.messages,cards.projects,cards.activeDays,cards.mps,heatmapTitle,topTitle,topByMessages,topByTokens,weeklyTitle,back}` — en values "Statistics", "30d", "90d", "1y", "All", "Sessions", "Messages", "Projects", "Active days", "Msgs / session", "Activity", "Top sessions", "By messages", "By tokens", "This week", "Back"; zh-Hant "統計", "30 天", "90 天", "1 年", "全部", "對話數", "訊息數", "專案數", "活躍天數", "每場訊息", "活動", "熱門對話", "依訊息數", "依 token", "本週", "返回".

- [ ] **Step 1: Failing tests** — `heatmapWeeks` unit tests (grid shape, null padding, date placement); component test: dashboard renders when nothing selected (mock invoke `sessions_stats` → fixture), card values shown, clicking a top-session row selects it (viewer appears), back button returns to dashboard.
- [ ] **Step 2: RED**, **Step 3: implement**, **Step 4: GREEN** (`pnpm test src/modules/sessions && pnpm typecheck`).
- [ ] **Step 5: Commit** `feat(sessions): dashboard with stat cards, heatmap, and top sessions`

---

### Task 3: Weekly digest + rough cost

**Files:**
- Create: `src/modules/sessions/lib/cost.ts`, `src/modules/sessions/lib/cost.test.ts`
- Modify: `src/modules/sessions/DashboardView.tsx`, locale files

**Interfaces:**

```ts
// cost.ts — rough OUTPUT-token cost only (the index has no input tokens).
// Price per 1M output tokens, USD. Substring match on the model id;
// unknown models contribute 0 and are reported as unpriced.
export const OUTPUT_PRICES_PER_MTOK: ReadonlyArray<[pattern: string, usd: number]> = [
  ["opus", 75], ["sonnet", 15], ["haiku", 4],
  ["gpt-5", 10], ["codex", 10], ["o3", 8],
  ["gemini", 10],
];
export function estimateOutputCost(models: ModelTokens[]): { usd: number; unpricedTokens: number };
```

- Digest card rows per agent: sessions · messages · tokens · `≈ $X.XX` (from that agent's models). Footer note `sessions.dashboard.costNote` — en "≈ output tokens only, rough estimate" / zh-Hant "≈ 僅計輸出 token，粗估".
- [ ] **Step 1: Failing tests** for `estimateOutputCost` (known model, mixed known/unknown, empty). **Step 2: RED → implement → GREEN.**
- [ ] **Step 3: Commit** `feat(sessions): weekly digest card with rough output-token cost`

---

### Task 4: Delete to trash

**Files:**
- Modify: `src-tauri/src/modules/sessions_index/index.rs` (`delete_session(&self, id)` removes sessions+activity+pins rows), `mod.rs` (command), `src-tauri/src/lib.rs`
- Modify: `src/modules/sessions/lib/statsBridge.ts` (add `sessionsDelete(id)`), `SessionsPanel.tsx` (hover trash button on rows), `SessionsTabContent.tsx` (header trash button), locale files

**Interfaces:**

```rust
/// Move the session's source file AND its companions to the OS trash, then
/// drop it from the index and emit sessions-index:updated. Companions:
/// claude → sibling dir named after the file stem (subagents/tool-results);
/// antigravity → -wal/-shm. Missing companions are skipped silently.
#[tauri::command]
pub async fn sessions_delete(app: AppHandle, state: State<'_, SessionsIndexState>, id: String) -> Result<(), String>;
```

- Frontend: both delete buttons open `ConfirmDialog` (danger variant if it has one — check the component's props) with `sessions.deleteConfirm` — en "Move this session's files to the Trash?" / zh-Hant "把這場對話的檔案丟到垃圾桶？"; on confirm `sessionsDelete(id)`; if the deleted id was selected, `select(null)`. Panel refresh rides the updated event.
- [ ] **Step 1: Rust failing tests**: temp fixture files (claude jsonl + companion dir; antigravity db + wal) in a temp "home"… trash::delete on CI/temp works against the real OS trash — instead test the pure parts: `companion_paths(agent, path) -> Vec<PathBuf>` helper (unit-tested for all three agents) and `Index::delete_session` row removal; the trash call itself stays a thin untested wrapper (same policy as fs/ops.rs).
- [ ] **Step 2: RED → implement → GREEN** (`cargo test sessions_index`).
- [ ] **Step 3: Frontend**: component test — clicking row delete opens the dialog, confirm invokes `sessions_delete` and clears selection when it was selected.
- [ ] **Step 4: GREEN** (`pnpm test src/modules/sessions && pnpm typecheck`).
- [ ] **Step 5: Commit** `feat(sessions): delete sessions to the OS trash with confirmation`

---

### Task 5: Export to Markdown

**Files:**
- Create: `src-tauri/src/modules/sessions_index/export.rs`
- Modify: `mod.rs` + `lib.rs` (command), `src/lib/dialog.ts` (add `saveFile(defaultPath)` using plugin-dialog `save`), `statsBridge.ts` (`sessionsExport(id)`), `SessionsTabContent.tsx` (header export button), locale files

**Interfaces:**

```rust
/// Renders a session transcript as Markdown: H1 title, metadata line
/// (agent · project · date range), then per-message sections — "## You" /
/// "## Assistant" (verbatim text), tool calls as fenced blocks labelled
/// with the tool name, injected turns as blockquoted collapsible context.
pub fn transcript_to_markdown(summary: &SessionSummary, messages: &[TranscriptMessage]) -> String;

#[tauri::command]  // async; parse via spawn_blocking like sessions_get
pub async fn sessions_export(state: State<'_, SessionsIndexState>, id: String) -> Result<String, String>;
```

- Frontend flow: export button → `sessionsExport(id)` → `saveFile(\`${title-slug}.md\`)` → cancelled = no-op → `fsWriteFile(path, md)`. Keys `sessions.export` — en "Export" / zh-Hant "匯出".
- [ ] **Step 1: Rust failing tests** for `transcript_to_markdown` (title/meta/roles/tool fencing/injected quoting; empty transcript → header only). **RED → implement → GREEN.**
- [ ] **Step 2: Frontend wiring** + component test (button invokes export; mocked save dialog path receives the content via fsWriteFile mock).
- [ ] **Step 3: GREEN**, **Step 4: Commit** `feat(sessions): export a session transcript to Markdown`

---

### Task 6: Verification + PR

- [ ] Full suites: `cargo test && cargo check`, `pnpm typecheck && pnpm test && pnpm build`.
- [ ] Manual sweep (rebuild app, clear WKWebView caches `~/Library/Caches/com.tempoterm.desktop` + `~/Library/WebKit/com.tempoterm.desktop`, relaunch): dashboard default screen, range filter, heatmap tooltip, top-session click-through + back, weekly digest ≈cost, delete (files land in Trash, list updates, selection clears), export (file written, renders in an editor).
- [ ] PR per project rules (label `enhancement`, milestone from `gh api`, assignee mukiwu), then track the gemini review.
