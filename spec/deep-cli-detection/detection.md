# Deep CLI Detection: Task Breakdown (shell-first design)

All backend work is in `src-tauri/src/modules/setup/mod.rs`; tests join the existing `#[cfg(test)] mod tests` block. Sequential TDD: pure functions get their named test first (red), then the implementation (green). Spawn wrappers get an `#[ignore]` real-env test in the style of `real_env_finds_nvm_installed_claude`.

Legend: (TF) = test-first pure function, (FS) = spawn wrapper, (WIRE) = integration, (FE) = frontend.

---

## Task 1 (TF): `tool_verdict`

Pull the installed / meets_min decision into a pure function encoding the exists-but-unprobeable fallback.

```rust
/// The (installed, meets_min) verdict for one tool. A resolved-but-unversioned
/// tool counts as installed; it satisfies meets_min only when the spec has no
/// minimum (fail closed: an unknown version must not be assumed new enough).
fn tool_verdict(version: Option<&str>, resolved: bool, min_version: Option<&str>) -> (bool, bool)
```

| version | resolved | min_version | installed | meets_min |
|---------|----------|-------------|-----------|-----------|
| Some(v) | (either) | Some(min)   | true      | meets_min(v, min) |
| Some(v) | (either) | None        | true      | true |
| None    | true     | None        | true      | true (the #232 outcome) |
| None    | true     | Some(min)   | true      | false (fail closed) |
| None    | false    | (either)    | false     | false |

Tests: `tool_verdict_absent_tool_is_not_installed`, `tool_verdict_probed_version_applies_min`, `tool_verdict_exists_but_unprobeable_no_min_is_ready`, `tool_verdict_exists_but_unprobeable_with_min_fails_closed`.

## Task 2 (TF): `shell_binary`

```rust
/// The shell to spawn for the batch probe: `$SHELL` when set, else the per-OS
/// fallback (`/bin/zsh` on macOS, `/bin/sh` elsewhere). Pure.
fn shell_binary(shell_env: Option<&str>, macos: bool) -> String
```

Test: `shell_binary_prefers_shell_env_then_os_fallback`.

## Task 3 (TF): `shell_probe_script`

One script probing every tool in a single shell spawn, each result sentinel-delimited so rc noise can't corrupt parsing:

```rust
const TOOL_SENTINEL_START: &str = "__TEMPO_TOOL_START__"; // followed by <id>__
const TOOL_SENTINEL_END: &str = "__TEMPO_TOOL_END__";

/// Build the batch probe script: for each (id, bin) emit
/// `printf '__TEMPO_TOOL_START__<id>__'; <bin> --version 2>/dev/null; printf '__TEMPO_TOOL_END__'`.
/// stderr is dropped (command-not-found noise); a missing tool yields an empty
/// block. Ids and bins come from the static TOOLS registry only — never user
/// input — so no quoting hazard. Pure.
fn shell_probe_script(tools: &[(&str, &str)]) -> String
```

Test: `shell_probe_script_wraps_every_tool_in_sentinels` — script contains one start marker per id, each bin followed by `--version`, `2>/dev/null` present.

## Task 4 (TF): `parse_shell_probe_output`

```rust
/// Per-tool version parsed out of the batch probe's stdout: for each sentinel
/// block, the first dotted numeric token (parse_version) of its body, or None
/// when the block is empty/garbage. Tolerates rc banners outside the blocks and
/// a truncated final block (timeout kill). Pure.
fn parse_shell_probe_output(output: &str) -> HashMap<String, Option<String>>
```

Tests:
- `parse_shell_probe_output_reads_versions_per_tool` — two blocks (`claude` → "2.1.195 (Claude Code)", `codex` → "codex-cli 0.144.5") parse to their versions; a third empty block (`agy`) is None.
- `parse_shell_probe_output_survives_rc_noise_and_truncation` — banner text before the first block is ignored; a block missing its end marker (killed shell) contributes nothing and does not corrupt earlier blocks.

## Task 5 (FS): `run_shell_probe`

```rust
/// Run the batch probe in the user's login shell: `shell_binary(...) -ilc <script>`,
/// stdin null, bounded by SHELL_PROBE_TIMEOUT (10s — one shell startup plus six
/// probes; killed on overrun like probe_version), then parse_shell_probe_output.
/// None on Windows or on any failure — detection then falls back per tool to the
/// directory scan. Called once per detect_tools run.
fn run_shell_probe(windows: bool) -> Option<HashMap<String, Option<String>>>
```

Reuses `tool_command` (CREATE_NO_WINDOW) and the `wait_timeout` kill pattern. Test: `real_shell_probe_reports_installed_tools`, `#[ignore]` env-dependent.

## Task 6 (WIRE): rewire `detect_tools_blocking`

```rust
let shell_versions = run_shell_probe(cfg!(windows));   // None on Windows/failed
let tools = TOOLS.iter().map(|spec| {
    let shell_version = shell_versions.as_ref().and_then(|m| m.get(spec.id).cloned().flatten());
    // Fallback (and disk evidence for the verdict) via the existing machinery.
    let resolved = find_tool(spec.bin);
    let version = shell_version.or_else(|| resolved.as_ref().and_then(|exe| /* existing probe */));
    let (installed, meets_min) = tool_verdict(version.as_deref(), resolved.is_some() || /* shell saw it */, spec.min_version);
    ...
});
```

Notes:
- A tool the shell answered for skips the fallback probe (no double spawn); `resolved` is still computed for the verdict's disk evidence — cheap, pure fs.
- "Shell saw it" (a version came back via the shell) counts as resolved for the verdict even when the dir scan misses the file (an install method we don't enumerate).
- brew/winget detection unchanged.
- Optional cleanup while here: `tool_search_dirs()` is recomputed per `tool_command`/`find_tool` call (#236 shape); hoisting it once per run is nice-to-have, not required.

## Task 7 (FE): unknown-version display check

Backend can now emit `installed=true, version=null`:
- No-min tools (claude/codex/agy): renders as "Installed", version span skipped — correct, no change.
- Min-required tools (node/git/gh): renders as "Version too old" (fail closed but mislabeled). **Open decision**: accept as-is, or add `status.unknownVersion` copy (en + zh-Hant) and a `phaseFor` guard for `installed && !meetsMin && version == null`. Default recommendation: add the copy (one string, one guard, one test in `setupTools.test.ts`).

---

## Manual test script

| Step | Action | Expected |
|------|--------|----------|
| 1 | Machine with codex under a custom npm prefix, GUI launch | Codex "Installed" |
| 2 | `SHELL=/bin/false` (broken shell) | Fallback path still detects nvm/homebrew installs |
| 3 | Rename node away, keep codex shim | Codex "Installed" (verdict layer), node fail-closed |
| 4 | Remove codex entirely | "Not installed" |
| 5 | Windows CI + manual wizard smoke | Shell probe skipped, fallback works, no console flash |

## Superseded from the previous plan revision

- Static-dir enumeration (npmrc prefix parser, bun/pnpm/deno/~/bin) — dropped; the shell probe covers these. `search_dirs` remains the seam if a targeted addition is ever needed.
- Login-shell **PATH capture** — superseded by probing inside the shell directly (same spawn cost, no PATH round-trip).
