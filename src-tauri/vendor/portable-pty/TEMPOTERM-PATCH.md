# TempoTerm patch

This directory vendors `portable-pty` 0.9.0 from crates.io.

TempoTerm changes the macOS Unix spawn path so open file descriptors are marked
`FD_CLOEXEC` in the parent process instead of enumerating and closing them from
the post-fork `pre_exec` callback. The latter runs in a multi-threaded Tauri app
and may crash before `exec`, as documented in wezterm/wezterm#7742.

Linux and Windows retain the upstream 0.9.0 behavior. Remove this patch only
after an upstream release contains an equivalent fix and TempoTerm's macOS PTY
regression tests pass against it.
