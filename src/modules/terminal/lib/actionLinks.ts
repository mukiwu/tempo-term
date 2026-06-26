/**
 * Detect actionable entities in a line of terminal output — IP addresses,
 * host:port pairs, and archive filenames — so the terminal can offer quick
 * commands (ping, curl, unzip, …) on hover. This is the matcher half; the
 * command/menu logic lives alongside it.
 */

export type ActionLinkKind = "ip" | "host-port" | "archive";

export interface ActionLinkMatch {
  /** The raw matched text. */
  text: string;
  /** Zero-based start index within the line. */
  start: number;
  /** Exclusive end index within the line. */
  end: number;
  /** Which kind of entity matched, so the caller can offer the right actions. */
  kind: ActionLinkKind;
}

/** A single dotted-decimal octet, 0-255. */
const OCTET = "(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";
const IPV4_RE = new RegExp(`\\b(?:${OCTET}\\.){3}${OCTET}\\b`, "g");

// host:port — the host must be a dotted name (domain or IP) or exactly
// `localhost`, which keeps `error:42`-style key:number pairs out.
const HOST_PORT_RE = /\b((?:[a-zA-Z0-9-]+\.)+[a-zA-Z0-9-]+|localhost):(\d{1,5})\b/g;

// Archive filenames. The double extensions (.tar.gz, …) come first in the
// alternation so the whole suffix is captured rather than just the trailing
// .gz. Greedy name matching keeps the full `backup.tar.gz`.
const ARCHIVE_RE =
  /\b\w[\w.-]*\.(?:tar\.(?:gz|bz2|xz)|tgz|tbz2?|txz|tar|zip|gz|bz2|xz|7z|rar)\b/g;

function collect(line: string, re: RegExp, kind: ActionLinkKind): ActionLinkMatch[] {
  const out: ActionLinkMatch[] = [];
  re.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(line)) !== null) {
    out.push({
      text: match[0],
      start: match.index,
      end: match.index + match[0].length,
      kind,
    });
  }
  return out;
}

/** A command the user can run against a matched entity. */
export interface TerminalAction {
  /** i18n key for the menu label (e.g. "actionLinks.ping"). */
  labelKey: string;
  /** Shell command to run, or the URL shown for a preview action. */
  command: string;
  /**
   * When set, the action opens this URL in the in-app web preview instead of
   * running `command` in the shell.
   */
  previewUrl?: string;
}

/** Matches a whole string that is exactly a dotted-decimal IPv4 address. */
const IPV4_HOST_RE = new RegExp(`^(?:${OCTET}\\.){3}${OCTET}$`);

/**
 * Whether a host should offer the in-app preview. Limited to localhost and IPs:
 * those are local servers that allow being framed, whereas public sites usually
 * block embedding (X-Frame-Options/CSP) and would render blank.
 */
function isPreviewableHost(host: string): boolean {
  return host === "localhost" || IPV4_HOST_RE.test(host);
}

/** Single-quote a filename for safe use in a shell command. */
function shellQuote(file: string): string {
  return `'${file.replace(/'/g, "'\\''")}'`;
}

/** The extract and list commands appropriate for an archive's extension. */
function archiveCommands(file: string): { extract: string; list: string | null } {
  const lower = file.toLowerCase();
  const q = shellQuote(file);
  const tar = (flags: string) => `tar -${flags} ${q}`;
  if (lower.endsWith(".tar.gz") || lower.endsWith(".tgz")) {
    return { extract: tar("xzf"), list: tar("tzf") };
  }
  if (lower.endsWith(".tar.bz2") || lower.endsWith(".tbz2") || lower.endsWith(".tbz")) {
    return { extract: tar("xjf"), list: tar("tjf") };
  }
  if (lower.endsWith(".tar.xz") || lower.endsWith(".txz")) {
    return { extract: tar("xJf"), list: tar("tJf") };
  }
  if (lower.endsWith(".tar")) {
    return { extract: tar("xf"), list: tar("tf") };
  }
  if (lower.endsWith(".zip")) {
    return { extract: `unzip ${q}`, list: `unzip -l ${q}` };
  }
  if (lower.endsWith(".gz")) {
    return { extract: `gunzip ${q}`, list: null };
  }
  if (lower.endsWith(".bz2")) {
    return { extract: `bunzip2 ${q}`, list: null };
  }
  if (lower.endsWith(".xz")) {
    return { extract: `unxz ${q}`, list: null };
  }
  if (lower.endsWith(".7z")) {
    return { extract: `7z x ${q}`, list: `7z l ${q}` };
  }
  if (lower.endsWith(".rar")) {
    return { extract: `unrar x ${q}`, list: `unrar l ${q}` };
  }
  return { extract: tar("xf"), list: tar("tf") };
}

// Patterns that make a command worth a confirmation prompt before it runs.
// None of the built-in actions hit these; this is a safety net for destructive
// commands so the run-on-click gesture can't silently do real damage.
const DANGEROUS_COMMAND_RES: RegExp[] = [
  /\brm\s+(?:-[a-z]*[rf]|--recursive|--force)\b/i, // rm -rf / -r / -f / --recursive / --force
  /\bdd\b[^\n]*\bof=/i, // dd writing to a device/file
  /\bmkfs\b/i, // formatting a filesystem
  /\|\s*(?:sudo\s+)?(?:sh|bash|zsh|fish)\b/i, // piping a download into a shell
  /:\(\)\s*\{.*\|.*&\s*\}\s*;/, // fork bomb
  />\s*\/dev\/[sh]d/i, // overwriting a raw disk device
];

/** True when a command is destructive enough to warrant a confirmation prompt. */
export function isDangerousCommand(command: string): boolean {
  return DANGEROUS_COMMAND_RES.some((re) => re.test(command));
}

/** Build the list of quick commands offered for a matched entity. */
export function actionsFor(match: ActionLinkMatch): TerminalAction[] {
  if (match.kind === "ip") {
    const ip = match.text;
    const url = `http://${ip}`;
    return [
      { labelKey: "actionLinks.preview", command: url, previewUrl: url },
      { labelKey: "actionLinks.ping", command: `ping ${ip}` },
      { labelKey: "actionLinks.traceroute", command: `traceroute ${ip}` },
      { labelKey: "actionLinks.ssh", command: `ssh ${ip}` },
      { labelKey: "actionLinks.curl", command: `curl http://${ip}` },
    ];
  }
  if (match.kind === "host-port") {
    const hostPort = match.text;
    const lastColon = hostPort.lastIndexOf(":");
    const host = hostPort.slice(0, lastColon);
    const port = hostPort.slice(lastColon + 1);
    const actions: TerminalAction[] = [];
    if (isPreviewableHost(host)) {
      const url = `http://${hostPort}`;
      actions.push({ labelKey: "actionLinks.preview", command: url, previewUrl: url });
    }
    actions.push(
      { labelKey: "actionLinks.curl", command: `curl http://${hostPort}` },
      { labelKey: "actionLinks.curlHttps", command: `curl https://${hostPort}` },
      { labelKey: "actionLinks.nc", command: `nc ${host} ${port}` },
      { labelKey: "actionLinks.telnet", command: `telnet ${host} ${port}` },
    );
    return actions;
  }
  if (match.kind === "archive") {
    const { extract, list } = archiveCommands(match.text);
    const actions: TerminalAction[] = [{ labelKey: "actionLinks.extract", command: extract }];
    if (list) {
      actions.push({ labelKey: "actionLinks.list", command: list });
    }
    return actions;
  }
  return [];
}

export function findActionLinks(line: string): ActionLinkMatch[] {
  // Collect every candidate, then resolve overlaps generically: sort by start
  // (and longest-first on ties) and keep a match only when it doesn't overlap
  // one already kept. This drops the IP inside `1.2.3.4:80` and the IP inside an
  // archive name like `1.2.3.4.zip`, always preferring the longer entity.
  const all = [
    ...collect(line, HOST_PORT_RE, "host-port"),
    ...collect(line, IPV4_RE, "ip"),
    ...collect(line, ARCHIVE_RE, "archive"),
  ].sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));

  const out: ActionLinkMatch[] = [];
  for (const m of all) {
    if (!out.some((kept) => m.start < kept.end && m.end > kept.start)) {
      out.push(m);
    }
  }
  return out;
}
