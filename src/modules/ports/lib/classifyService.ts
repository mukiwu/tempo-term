import type { PortInfo } from "./portsBridge";

export interface ServiceKind {
  /** Plain-English service name, the way Port Radar labels rows. */
  label: string;
  /** Stable id for styling (badge colors etc.). */
  kind: string;
}

/** Ordered: first match on the full command line wins, then process name. */
const COMMAND_RULES: Array<[RegExp, ServiceKind]> = [
  [/vite/i, { label: "Vite dev server", kind: "vite" }],
  [/next[/\\ ]dist[/\\ ]bin[/\\ ]next|next dev|next start/i, { label: "Next.js dev server", kind: "next" }],
  [/webpack/i, { label: "Webpack dev server", kind: "webpack" }],
  [/storybook/i, { label: "Storybook", kind: "storybook" }],
];

const PROCESS_RULES: Array<[RegExp, ServiceKind]> = [
  [/^docker|com\.docker/i, { label: "Docker", kind: "docker" }],
  [/^postgres/i, { label: "PostgreSQL", kind: "postgres" }],
  [/^redis/i, { label: "Redis", kind: "redis" }],
  [/^mysqld/i, { label: "MySQL", kind: "mysql" }],
  [/^python/i, { label: "Python server", kind: "python" }],
  [/^ruby/i, { label: "Ruby server", kind: "ruby" }],
  [/^java$/i, { label: "Java service", kind: "java" }],
  [/^(node|bun|deno)$/i, { label: "", kind: "" }], // runtime fallback below
];

const RUNTIME_LABELS: Record<string, ServiceKind> = {
  node: { label: "Node.js", kind: "node" },
  bun: { label: "Bun", kind: "bun" },
  deno: { label: "Deno", kind: "deno" },
};

/**
 * Turn a raw process into the plain-English label a reader scans for —
 * "Vite dev server", not "node". Command line beats process name (the
 * interesting part of `node .../vite` is vite); a known runtime is the next
 * best answer; the raw process name is the honest last resort.
 */
export function classifyService(info: PortInfo): ServiceKind {
  const command = info.command ?? "";
  for (const [re, kind] of COMMAND_RULES) {
    if (re.test(command)) return kind;
  }
  const name = info.processName ?? "";
  for (const [re, kind] of PROCESS_RULES) {
    if (re.test(name) && kind.label) return kind;
  }
  const runtime = RUNTIME_LABELS[name.toLowerCase()];
  if (runtime) return runtime;
  return { label: name || "Unknown", kind: "other" };
}

export interface PortGroup {
  /** Project directory basename; null for the trailing catch-all group. */
  name: string | null;
  cwd: string | null;
  ports: PortInfo[];
}

/**
 * Two stable levels: projects alphabetically (the catch-all last), ports by
 * number inside each. Combined with the backend's (port, pid) sort this is
 * what keeps the panel from reshuffling under the reader's eyes.
 */
export function groupByProject(ports: PortInfo[]): PortGroup[] {
  const byCwd = new Map<string, PortGroup>();
  const orphans: PortInfo[] = [];
  for (const port of ports) {
    if (!port.cwd) {
      orphans.push(port);
      continue;
    }
    const existing = byCwd.get(port.cwd);
    if (existing) {
      existing.ports.push(port);
    } else {
      const name = port.cwd.replace(/[/\\]+$/, "").split(/[/\\]/).pop() || port.cwd;
      byCwd.set(port.cwd, { name, cwd: port.cwd, ports: [port] });
    }
  }
  const groups = [...byCwd.values()].sort((a, b) =>
    (a.name ?? "") < (b.name ?? "") ? -1 : (a.name ?? "") > (b.name ?? "") ? 1 : 0,
  );
  for (const group of groups) group.ports.sort((a, b) => a.port - b.port || a.pid - b.pid);
  if (orphans.length > 0) {
    orphans.sort((a, b) => a.port - b.port || a.pid - b.pid);
    groups.push({ name: null, cwd: null, ports: orphans });
  }
  return groups;
}
