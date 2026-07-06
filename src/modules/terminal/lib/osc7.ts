/**
 * OSC 7 working-directory reports (`ESC ] 7 ; file://host/path ST`), the cwd
 * source for the explorer-follows-terminal feature on Windows.
 *
 * macOS/Linux read the shell's cwd from the OS (lsof / /proc — see
 * `read_process_cwd` in src-tauri/src/modules/pty/session.rs); Windows has no
 * such backend, so the injected shell integration (a PowerShell prompt wrapper
 * / a cmd.exe PROMPT prefix — see `windows_integration_args` /
 * `windows_integration_env` in src-tauri/src/modules/pty/shell.rs) makes the
 * shell announce its cwd in an OSC 7 sequence at every prompt instead.
 */

/**
 * Parse an OSC 7 payload into a local Windows path, or null when it isn't one.
 *
 * Accepts only local reports: the host must be empty or `localhost`, and the
 * path must be drive-lettered. That rejects cwd reports leaking from a remote
 * shell (`ssh` run inside the pane, WSL) whose directories don't exist here —
 * matching macOS, where a pane running ssh keeps the explorer on the local dir.
 *
 * Tolerates both local emitters: PowerShell sends a percent-encoded URI
 * (`file:///C:/Users/f%20o`), while cmd.exe's PROMPT expands `$P` raw
 * (`file://localhost/C:\Users\f o` — spaces, backslashes and `%` unencoded).
 */
export function parseOsc7Cwd(payload: string): string | null {
  // Cap the raw input before any decoding or regex work: a hostile or runaway
  // program can emit a multi-megabyte OSC 7 sequence, and while the post-decode
  // length check below already rejects the result, there is no reason to spend
  // decodeURIComponent + regex passes on it first. 8192 comfortably covers the
  // worst legit case (a fully percent-encoded CJK path is 9 chars per
  // character, so ~900 path characters — far beyond any practical cwd).
  if (payload.length > 8192 || !payload.startsWith("file://")) {
    return null;
  }
  const rest = payload.slice("file://".length);
  const cut = rest.indexOf("/");
  if (cut === -1) {
    return null;
  }
  const host = rest.slice(0, cut);
  if (host !== "" && host.toLowerCase() !== "localhost") {
    return null;
  }
  let path = rest.slice(cut + 1);
  try {
    path = decodeURIComponent(path);
  } catch {
    // cmd's raw $P can contain a bare `%` that breaks decoding; keep it as-is.
  }
  if (!/^[A-Za-z]:([\\/]|$)/.test(path)) {
    return null;
  }
  let win = path.replace(/\//g, "\\").replace(/\\+$/, "");
  if (/^[A-Za-z]:$/.test(win)) {
    // The drive root arrives as `file:///C:/`; keep it spelled `C:\` (a bare
    // `C:` means "current dir on C:" to Windows, not the root).
    win += "\\";
  }
  // Real Windows paths never contain control characters — but decodeURIComponent
  // reconstitutes them from percent-encoding *after* xterm's parser has already
  // filtered raw control bytes. Reject them so hostile terminal output can't
  // smuggle line breaks into the persisted workspace root (interpolated verbatim
  // into the AI system prompt — `Current workspace folder: ${root}`), and bound
  // the length since the value is persisted. The set covers C0 and DEL plus the
  // C1 controls (e.g. NEL U+0085) and the Unicode LINE/PARAGRAPH SEPARATOR
  // (U+2028/U+2029) — all line-break primitives equally absent from real paths.
  if (win.length > 4096 || /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(win)) {
    return null;
  }
  return win;
}

/**
 * Parse an OSC 7 payload from a *remote* shell into a POSIX absolute path, or
 * null when it isn't one. Unlike `parseOsc7Cwd` (Windows-local, drive-lettered,
 * localhost-only) this accepts any host: the report arrives on an SSH pane's
 * own byte stream, so the pane's connectionId — not the URI host — identifies
 * the machine. Applies the same size and control-character hardening, since the
 * result becomes the persisted workspace root.
 */
export function parseOsc7RemotePath(payload: string): string | null {
  if (payload.length > 8192 || !payload.startsWith("file://")) {
    return null;
  }
  const rest = payload.slice("file://".length);
  const cut = rest.indexOf("/");
  if (cut === -1) {
    return null;
  }
  let path = rest.slice(cut);
  try {
    path = decodeURIComponent(path);
  } catch {
    // A bare `%` from a naive emitter; keep the raw text.
  }
  const clean = path.replace(/\/+$/, "") || "/";
  if (clean.length > 4096 || /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(clean)) {
    return null;
  }
  return clean;
}
