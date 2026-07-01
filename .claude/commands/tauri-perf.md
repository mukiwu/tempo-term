Run a Tauri 2 performance review on the current git diff.

Launch the `tauri-performance-reviewer` agent to execute the review.

Focus areas: IPC payload size (`tauri::ipc::Response` for binary, `Channel` for streaming), async command usage, state lock contention (sync `Mutex` vs Tokio `Mutex` across `.await`), unnecessary serde JSON for large data, excessive `invoke()` round-trips, frontend bundle size, startup time.

When to use: after each commit push, especially when modifying Rust commands, IPC types, state management, or large-data handling.
